"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TakeoutItem = {
  name?: string | null;
  price?: number | string | null;
  quantity?: number | string | null;
};

type TakeoutOrder = {
  id?: string | null;
  order_id?: string | null;
  booking_id?: string | null;
  booking_code?: string | null;
  vendor_id?: string | null;
  vendor_status?: string | null;
  customer_status?: string | null;
  status?: string | null;
  service_type?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  customer_name?: string | null;
  passenger_name?: string | null;
  customer_phone?: string | null;
  note?: string | null;
  customer_note?: string | null;
  passenger_note?: string | null;
  system_instructions?: string[] | null;
  to_label?: string | null;
  dropoff_label?: string | null;
  items?: TakeoutItem[] | null;
  items_subtotal?: number | string | null;
  total_bill?: number | string | null;
};

type ApiResult = {
  ok?: boolean;
  error?: string;
  message?: string;
  orders?: TakeoutOrder[];
  [key: string]: unknown;
};

const LS_VENDOR_ID = "JRIDE_TAKEOUT_VENDOR_ID";
const LS_VENDOR_SOUND_ENABLED = "jride_vendor_sound_enabled";
const VENDOR_ALERT_SOUND_URL = "/sounds/vendor-order-alert.mp3";
const REFRESH_MS = 10000;
const VENDOR_ALERT_REPEAT_MS = 30000;
const VENDOR_ALERT_MAX_MS = 5 * 60 * 1000;

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function money(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "PHP 0.00";
  return "PHP " + n.toFixed(2);
}

function orderId(order: TakeoutOrder): string {
  return text(order.id || order.order_id || order.booking_id);
}

function code(order: TakeoutOrder): string {
  return text(order.booking_code) || orderId(order).slice(0, 8) || "-";
}

function statusOf(order: TakeoutOrder): string {
  return text(order.customer_status || order.vendor_status || order.status || "requested").toLowerCase();
}

function displayStatus(order: TakeoutOrder): string {
  const s = statusOf(order);
  if (s === "vendor_pending" || s === "requested" || s === "") return "vendor_pending";
  if (s === "accepted") return "vendor_accepted";
  if (s === "pickup_ready" || s === "ready" || s === "prepared" || s === "driver_arrived") return "ready_for_pickup";
  if (s === "preparing_order") return "preparing";
  return s || "vendor_pending";
}

const VENDOR_REJECT_REASONS = [
  "Out of stock",
  "Store closed",
  "Item unavailable",
  "Too many active orders",
  "Outside delivery service coverage",
  "Vendor unavailable",
  "Other",
];

const VENDOR_CANCEL_REASONS = [
  "Kitchen issue",
  "Ingredient unavailable",
  "Vendor emergency",
  "Cannot fulfill order",
  "Too many active orders",
  "Other",
];

function statusClass(status: string): string {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "cancelled" || status === "canceled") return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "ready_for_pickup" || status === "pickup_ready" || status === "ready") return "border-blue-200 bg-blue-50 text-blue-800";
  if (status === "preparing") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "vendor_accepted") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "vendor_pending") return "border-slate-200 bg-slate-50 text-slate-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function vendorStatusLabel(status: string): string {
  if (status === "vendor_pending") return "Waiting for vendor confirmation";
  if (status === "vendor_accepted") return "Vendor accepted";
  if (status === "preparing") return "Vendor preparing order";
  if (status === "ready_for_pickup") return "Ready for pickup";
  if (status === "completed") return "Completed";
  if (status === "cancelled" || status === "canceled") return "Cancelled";
  return status || "Waiting for vendor confirmation";
}

function isActive(order: TakeoutOrder): boolean {
  const s = displayStatus(order);
  return s !== "completed" && s !== "cancelled" && s !== "canceled";
}

async function readJson(url: string): Promise<ApiResult> {
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(text((body as ApiResult).message || (body as ApiResult).error) || "REQUEST_FAILED");
  }
  return body as ApiResult;
}

async function postJson(url: string, payload: Record<string, unknown>): Promise<ApiResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(text((body as ApiResult).message || (body as ApiResult).error) || "REQUEST_FAILED");
  }
  return body as ApiResult;
}

export default function VendorTakeoutOrdersPage() {
  const [vendorId, setVendorId] = useState("");
  const [orders, setOrders] = useState<TakeoutOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [cancelDraft, setCancelDraft] = useState<{ order: TakeoutOrder; mode: "reject" | "cancel" } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelOtherReason, setCancelOtherReason] = useState("");
  const [message, setMessage] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundUnlocked, setSoundUnlocked] = useState(false);
  const [soundError, setSoundError] = useState("");
  const [soundDebug, setSoundDebug] = useState({
    pendingCount: 0,
    audioUnlocked: false,
    loopState: "stopped",
    lastAttempt: "never",
    lastResult: "none",
  });
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);
  const alertTimerRef = useRef<number | null>(null);
  const alertStartedAtRef = useRef(0);
  const lastPendingKeyRef = useRef("");

  const [error, setError] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    try {
      const saved = text(window.localStorage.getItem(LS_VENDOR_ID));
      if (saved) setVendorId(saved);

      const soundPref = text(window.localStorage.getItem(LS_VENDOR_SOUND_ENABLED));
      if (soundPref === "1") setSoundEnabled(true);
    } catch {
      // localStorage may be blocked; ignore.
    }
  }, []);

  const markVendorAudioUnlocked = useCallback(() => {
    setSoundUnlocked(true);
    audioUnlockedRef.current = true;
    setSoundDebug((prev) => ({ ...prev, audioUnlocked: true }));
  }, []);

  const playVendorAlert = useCallback(async (reason: string = "auto") => {
    if (typeof window === "undefined") return false;

    const attempt = new Date().toLocaleTimeString();
    setSoundDebug((prev) => ({
      ...prev,
      lastAttempt: attempt + " (" + reason + ")",
      lastResult: "starting",
    }));

    if (!audioUnlockedRef.current) {
      setSoundDebug((prev) => ({ ...prev, lastResult: "blocked: audio not unlocked" }));
      return false;
    }

    const audio = audioElementRef.current;
    if (!audio) {
      setSoundError("Vendor sound audio element is not ready. Refresh the page, then click Enable vendor sound.");
      setSoundDebug((prev) => ({ ...prev, lastResult: "failed: audio element missing" }));
      return false;
    }

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 1;
      audio.muted = false;
      audio.src = VENDOR_ALERT_SOUND_URL;
      audio.load();

      await audio.play();

      setSoundError("");
      setSoundDebug((prev) => ({ ...prev, lastResult: "played" }));
      return true;
    } catch (err: any) {
      const msg = text(err?.name || err?.message || err) || "PLAY_FAILED";
      setSoundError("Vendor sound could not play: " + msg + ". Click Enable vendor sound or Test sound again, then keep this page open.");
      setSoundDebug((prev) => ({ ...prev, lastResult: "failed: " + msg }));
      return false;
    }
  }, []);

  const stopVendorAlertLoop = useCallback(() => {
    if (alertTimerRef.current != null) {
      window.clearInterval(alertTimerRef.current);
      alertTimerRef.current = null;
    }
    alertStartedAtRef.current = 0;
    setSoundDebug((prev) => ({ ...prev, loopState: "stopped" }));
  }, []);

  const enableVendorSound = useCallback(async () => {
    setSoundEnabled(true);
    setSoundUnlocked(true);
    setSoundError("");
    audioUnlockedRef.current = true;
    try {
      window.localStorage.setItem(LS_VENDOR_SOUND_ENABLED, "1");
    } catch {
      // localStorage may be blocked; ignore.
    }
    await playVendorAlert("enable");
  }, [playVendorAlert]);

  const disableVendorSound = useCallback(() => {
    setSoundEnabled(false);
    setSoundUnlocked(false);
    audioUnlockedRef.current = false;
    stopVendorAlertLoop();
    try {
      window.localStorage.setItem(LS_VENDOR_SOUND_ENABLED, "0");
    } catch {
      // localStorage may be blocked; ignore.
    }
  }, [stopVendorAlertLoop]);

  const testVendorSound = useCallback(async () => {
    setSoundUnlocked(true);
    audioUnlockedRef.current = true;
    await playVendorAlert("test");
  }, [playVendorAlert]);

  const loadOrders = useCallback(async () => {
    const vid = text(vendorId);
    if (!vid) {
      setOrders([]);
      return;
    }

    setLoading(true);
    setError("");
    try {
      try {
        window.localStorage.setItem(LS_VENDOR_ID, vid);
      } catch {
        // localStorage may be blocked; ignore.
      }

      const data = await readJson("/api/vendor-orders?vendor_id=" + encodeURIComponent(vid));
      const list = Array.isArray(data.orders) ? data.orders : [];
      setOrders(list);
      setMessage("Loaded " + list.length + " order(s).");
    } catch (err: any) {
      setError(text(err?.message) || "Failed to load vendor orders.");
    } finally {
      setLoading(false);
    }
  }, [vendorId]);


  useEffect(() => {
    if (!text(vendorId)) return;
    void loadOrders();
  }, [vendorId, loadOrders]);


  useEffect(() => {
    if (!text(vendorId)) return;
    const timer = window.setInterval(() => {
      void loadOrders();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [vendorId, loadOrders]);

  async function updateStatus(order: TakeoutOrder, vendorStatus: string, explicitReason?: string) {
    const vid = text(vendorId);
    const id = orderId(order);
    if (!vid || !id) return;

    const payload: Record<string, any> = {
      vendor_id: vid,
      order_id: id,
      vendor_status: vendorStatus,
    };

    if (vendorStatus === "cancelled") {
      const cleanedReason = text(explicitReason);
      if (!cleanedReason) {
        setError("Reject/cancel reason is required.");
        return;
      }
      payload.cancel_reason = cleanedReason;
      payload.vendor_cancel_reason = cleanedReason;
    }

    setSavingId(id);
    setError("");
    setMessage("");
    try {
      await postJson("/api/vendor-orders", payload);
      setMessage("Order " + code(order) + " updated to " + vendorStatus + ".");
      setCancelDraft(null);
      setCancelReason("");
      setCancelOtherReason("");
      await loadOrders();
    } catch (err: any) {
      setError(text(err?.message) || "Failed to update order.");
    } finally {
      setSavingId(null);
    }
  }

  function openCancelDraft(order: TakeoutOrder) {
    const currentStatus = displayStatus(order);
    const mode = currentStatus === "vendor_pending" ? "reject" : "cancel";
    const reasons = mode === "reject" ? VENDOR_REJECT_REASONS : VENDOR_CANCEL_REASONS;

    setError("");
    setMessage("");
    setCancelDraft({ order, mode });
    setCancelReason(reasons[0] || "");
    setCancelOtherReason("");
  }

  async function submitCancelDraft() {
    if (!cancelDraft) return;

    const selected = text(cancelReason);
    const finalReason = selected === "Other" ? text(cancelOtherReason) : selected;

    if (!finalReason) {
      setError("Please choose a reason. If you choose Other, type the reason.");
      return;
    }

    await updateStatus(cancelDraft.order, "cancelled", finalReason);
  }

  const visibleOrders = useMemo(() => {
    return orders.filter((order) => showCompleted || isActive(order));
  }, [orders, showCompleted]);

  const pendingVendorOrders = useMemo(() => {
    return orders.filter((order) => {
      const vendorStatus = text(order.vendor_status).toLowerCase();
      const rideStatus = text(order.status).toLowerCase();
      const shownStatus = displayStatus(order);

      return (
        shownStatus === "vendor_pending" ||
        vendorStatus === "vendor_pending" ||
        vendorStatus === "requested" ||
        rideStatus === "requested"
      );
    });
  }, [orders]);

  const pendingVendorKey = useMemo(() => {
    return pendingVendorOrders
      .map((order) => code(order) || orderId(order))
      .filter(Boolean)
      .sort()
      .join("|");
  }, [pendingVendorOrders]);

  useEffect(() => {
    function unlockAudio() {
      markVendorAudioUnlocked();
    }

    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, [markVendorAudioUnlocked]);

  useEffect(() => {
    stopVendorAlertLoop();

    const pendingCount = pendingVendorOrders.length;
    setSoundDebug((prev) => ({
      ...prev,
      pendingCount,
      audioUnlocked: audioUnlockedRef.current,
      loopState: soundEnabled && audioUnlockedRef.current && pendingCount > 0 ? "starting" : "stopped",
    }));

    if (!soundEnabled || !audioUnlockedRef.current || pendingCount === 0) {
      lastPendingKeyRef.current = pendingVendorKey;
      return;
    }

    const startedAt = Date.now();
    alertStartedAtRef.current = startedAt;
    lastPendingKeyRef.current = pendingVendorKey;

    void playVendorAlert("pending");
    setSoundDebug((prev) => ({ ...prev, loopState: "running" }));

    alertTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;

      if (elapsed >= VENDOR_ALERT_MAX_MS) {
        stopVendorAlertLoop();
        setSoundDebug((prev) => ({ ...prev, loopState: "max time reached" }));
        return;
      }

      void playVendorAlert("repeat");
    }, VENDOR_ALERT_REPEAT_MS);

    return () => {
      stopVendorAlertLoop();
    };
  }, [
    soundEnabled,
    soundUnlocked,
    pendingVendorOrders.length,
    pendingVendorKey,
    playVendorAlert,
    stopVendorAlertLoop,
  ]);

  useEffect(() => {
    const originalTitle = document.title || "JRide Vendor Orders";
    if (pendingVendorOrders.length > 0) {
      document.title = `(${pendingVendorOrders.length}) Vendor Orders - JRide`;
    } else {
      document.title = originalTitle;
    }
    return () => {
      document.title = originalTitle;
    };
  }, [pendingVendorOrders.length]);

  useEffect(() => {
    return () => stopVendorAlertLoop();
  }, [stopVendorAlertLoop]);

  const totals = useMemo(() => {
    let active = 0;
    let completed = 0;
    let gross = 0;
    for (const order of orders) {
      const status = displayStatus(order);
      if (status === "completed") completed += 1;
      else if (status !== "cancelled" && status !== "canceled") active += 1;
      gross += Number(order.items_subtotal ?? order.total_bill ?? 0) || 0;
    }
    return { active, completed, gross };
  }, [orders]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">JRide Takeout</p>
              <h1 className="mt-1 text-2xl font-bold">Vendor Orders Dashboard</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Pilot dashboard for receiving takeout orders and updating vendor status. This page does not call ride dispatch, ride fare, or trip lifecycle routes.
              </p>
            </div>
            <button
              type="button"
              onClick={loadOrders}
              disabled={loading || !text(vendorId)}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Vendor ID</span>
              <input
                value={vendorId}
                onChange={(event) => setVendorId(event.target.value)}
                placeholder="Paste vendor UUID here"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={showCompleted}
                onChange={(event) => setShowCompleted(event.target.checked)}
              />
              Show completed/cancelled
            </label>
          </div>

          <audio ref={audioElementRef} src={VENDOR_ALERT_SOUND_URL} preload="auto" className="hidden" />

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <button
              type="button"
              onClick={soundEnabled ? disableVendorSound : enableVendorSound}
              className={
                "rounded-full border px-3 py-1 font-medium " +
                (soundEnabled
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : "border-slate-300 bg-white text-slate-700")
              }
            >
              {soundEnabled ? "Disable vendor sound" : "Enable vendor sound"}
            </button>
            <button
              type="button"
              onClick={testVendorSound}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 font-medium text-slate-700"
            >
              Test sound
            </button>
            <span>Vendor alert sound: {soundEnabled ? "on" : "off"}</span>
            <span className={pendingVendorOrders.length > 0 ? "rounded-full border border-amber-300 bg-amber-50 px-2 py-1 font-semibold text-amber-800" : "rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600"}>
              Pending accept: {pendingVendorOrders.length}
            </span>
            {soundUnlocked ? <span className="text-emerald-700">Audio unlocked</span> : <span>Click Enable or Test once to unlock audio.</span>}
          </div>

          <div className="mt-2 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 md:grid-cols-5">
            <div>Sound enabled: <span className="font-semibold">{soundEnabled ? "yes" : "no"}</span></div>
            <div>Audio unlocked: <span className="font-semibold">{soundDebug.audioUnlocked ? "yes" : "no"}</span></div>
            <div>Pending count: <span className="font-semibold">{soundDebug.pendingCount}</span></div>
            <div>Loop: <span className="font-semibold">{soundDebug.loopState}</span></div>
            <div>Last: <span className="font-semibold">{soundDebug.lastAttempt} - {soundDebug.lastResult}</span></div>
          </div>
          {soundError ? (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Vendor sound warning: {soundError}
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Active orders</div>
              <div className="mt-1 text-2xl font-bold">{totals.active}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Completed</div>
              <div className="mt-1 text-2xl font-bold">{totals.completed}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Listed gross subtotal</div>
              <div className="mt-1 text-2xl font-bold">{money(totals.gross)}</div>
            </div>
          </div>

          {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div> : null}
          {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
        </section>

        <section className="space-y-3">
          {!text(vendorId) ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              Enter a vendor ID to load takeout orders.
            </div>
          ) : loading && visibleOrders.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading orders...</div>
          ) : visibleOrders.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">No takeout orders found for this view.</div>
          ) : (
            visibleOrders.map((order) => {
              const id = orderId(order);
              const currentStatus = displayStatus(order);
              const isSaving = savingId === id;
              const items = Array.isArray(order.items) ? order.items : [];

              return (
                <article key={id || code(order)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-bold">{code(order)}</h2>
                        <span className={"rounded-full border px-2 py-1 text-xs font-semibold " + statusClass(currentStatus)}>
                          {vendorStatusLabel(currentStatus)}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        {text(order.customer_name || order.passenger_name) || "Customer"}
                        {text(order.customer_phone) ? " - " + text(order.customer_phone) : ""}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">Deliver to: {text(order.to_label || order.dropoff_label) || "-"}</div>
                      <div className="mt-1 text-xs text-slate-400">Created: {text(order.created_at) || "-"}</div>
                    </div>
                    <div className="text-left md:text-right">
                      <div className="text-xs text-slate-500">Subtotal</div>
                      <div className="text-xl font-bold">{money(order.items_subtotal ?? order.total_bill)}</div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Items</div>
                    {items.length === 0 ? (
                      <div className="mt-2 text-sm text-slate-500">No item snapshot found.</div>
                    ) : (
                      <div className="mt-2 divide-y divide-slate-200">
                        {items.map((item, index) => {
                          const qty = Number(item.quantity ?? 1) || 1;
                          const price = Number(item.price ?? 0) || 0;
                          return (
                            <div key={index} className="flex items-center justify-between gap-3 py-2 text-sm">
                              <div>
                                <div className="font-semibold">{text(item.name) || "Item"}</div>
                                <div className="text-xs text-slate-500">Qty {qty} x {money(price)}</div>
                              </div>
                              <div className="font-semibold">{money(qty * price)}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {text(order.customer_note || order.passenger_note || order.note) ? (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <div className="font-semibold">Customer note</div>
                      <div className="mt-1 whitespace-pre-wrap">{text(order.customer_note || order.passenger_note || order.note)}</div>
                    </div>
                  ) : null}

                  {Array.isArray(order.system_instructions) && order.system_instructions.length > 0 ? (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                      <div className="font-semibold text-slate-800">System instructions</div>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {order.system_instructions.map((line, idx) => (
                          <li key={idx}>{text(line)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}


                  <div className="mt-4 flex flex-wrap gap-2">
                    {currentStatus === "vendor_pending" ? (
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => updateStatus(order, "vendor_accepted")}
                        className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Accept order
                      </button>
                    ) : null}
                    {currentStatus === "vendor_accepted" ? (
                      <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800">Vendor accepted. Driver assignment can proceed. No second vendor action is required until pickup is ready.</div>
                    ) : null}
                    {currentStatus === "preparing" ? (
                      <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800">Vendor accepted. Waiting for pickup readiness.</div>
                    ) : null}
                    {(currentStatus === "ready_for_pickup" || currentStatus === "pickup_ready") ? (
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => updateStatus(order, "completed")}
                        className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Complete
                      </button>
                    ) : null}
                    {currentStatus !== "completed" && currentStatus !== "cancelled" ? (
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => openCancelDraft(order)}
                        className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {currentStatus === "vendor_pending" ? "Reject order" : "Cancel order"}
                      </button>
                    ) : null}
                    {isSaving ? <span className="self-center text-sm text-slate-500">Saving...</span> : null}
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
          {cancelDraft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-3">
              <div className="text-lg font-semibold text-slate-900">
                {cancelDraft.mode === "reject" ? "Reject order" : "Cancel order"}
              </div>
              <div className="mt-1 text-sm text-slate-600">
                Order {code(cancelDraft.order)}
              </div>
            </div>

            <label className="text-sm font-medium text-slate-700">Reason</label>
            <select
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              value={cancelReason}
              onChange={(e) => {
                setCancelReason(e.target.value);
                if (e.target.value !== "Other") setCancelOtherReason("");
              }}
            >
              {(cancelDraft.mode === "reject" ? VENDOR_REJECT_REASONS : VENDOR_CANCEL_REASONS).map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>

            {cancelReason === "Other" ? (
              <div className="mt-3">
                <label className="text-sm font-medium text-slate-700">Type reason</label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  value={cancelOtherReason}
                  onChange={(e) => setCancelOtherReason(e.target.value)}
                  placeholder="Enter vendor reason"
                />
              </div>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setCancelDraft(null);
                  setCancelReason("");
                  setCancelOtherReason("");
                }}
                disabled={!!savingId}
              >
                Keep order
              </button>
              <button
                type="button"
                className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => submitCancelDraft()}
                disabled={!!savingId || (cancelReason === "Other" && !text(cancelOtherReason))}
              >
                {savingId ? "Saving..." : cancelDraft.mode === "reject" ? "Reject order" : "Cancel order"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </main>
  );
}
