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
};

type OrderView = "active" | "history";

const VENDOR_ID_KEYS = [
  "JRIDE_VENDOR_PORTAL_VENDOR_ID",
  "jride_vendor_id",
  "JRIDE_VENDOR_ID",
  "vendor_id",
  "JRIDE_TAKEOUT_VENDOR_ID",
] as const;

const LS_VENDOR_SOUND_ENABLED = "jride_vendor_sound_enabled";
const VENDOR_ALERT_SOUND_URL = "/sounds/vendor-order-alert.mp3";
const REFRESH_MS = 10000;
const VENDOR_ALERT_REPEAT_MS = 30000;
const VENDOR_ALERT_MAX_MS = 5 * 60 * 1000;
const VENDOR_ACCEPT_WINDOW_MS = 5 * 60 * 1000;

const VENDOR_REJECT_REASONS = [
  "Out of stock",
  "Store closed",
  "Item unavailable",
  "Too many active orders",
  "Outside delivery service coverage",
  "Vendor unavailable",
  "Other",
] as const;

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function money(value: unknown): string {
  const amount = Number(value ?? 0);
  return "PHP " + (Number.isFinite(amount) ? amount : 0).toFixed(2);
}

function readVendorId(): string {
  if (typeof window === "undefined") return "";

  const queryId = clean(new URLSearchParams(window.location.search).get("vendor_id"));
  if (queryId) return queryId;

  for (const key of VENDOR_ID_KEYS) {
    const values = [window.sessionStorage.getItem(key), window.localStorage.getItem(key)];
    for (const value of values) {
      const id = clean(value);
      if (id) return id;
    }
  }

  return "";
}

function persistVendorId(vendorId: string) {
  if (typeof window === "undefined") return;
  const id = clean(vendorId);
  if (!id) return;
  for (const key of VENDOR_ID_KEYS) {
    try {
      window.localStorage.setItem(key, id);
      window.sessionStorage.setItem(key, id);
    } catch {
      // Storage can be unavailable in restricted WebViews.
    }
  }
}

function formatPhilippineDateTime(value: unknown): string {
  const raw = clean(value);
  if (!raw) return "-";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return raw;
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function orderId(order: TakeoutOrder): string {
  return clean(order.id || order.order_id || order.booking_id);
}

function orderCode(order: TakeoutOrder): string {
  return clean(order.booking_code) || orderId(order).slice(0, 8) || "Order";
}

function normalizedStatus(order: TakeoutOrder): string {
  // Vendor workflow status is authoritative on the vendor screen.
  const raw = clean(order.vendor_status || order.status || order.customer_status || "vendor_pending").toLowerCase();
  if (!raw || raw === "requested") return "vendor_pending";
  if (raw === "accepted") return "vendor_accepted";
  if (raw === "canceled") return "cancelled";
  if (raw === "ready" || raw === "prepared" || raw === "ready_for_pickup") return "pickup_ready";
  if (raw === "preparing_order") return "preparing";
  return raw;
}

function isHistoryStatus(status: string): boolean {
  return status === "completed" || status === "cancelled" || status === "vendor_timeout";
}

function statusLabel(status: string): string {
  if (status === "vendor_pending") return "Waiting for confirmation";
  if (status === "vendor_accepted") return "Vendor accepted";
  if (status === "driver_assigned") return "Driver selected";
  if (status === "driver_accepted") return "Driver accepted";
  if (status === "preparing") return "Preparing";
  if (status === "pickup_ready") return "Ready for pickup";
  if (status === "completed") return "Completed";
  if (status === "vendor_timeout") return "Vendor timeout";
  if (status === "cancelled") return "Cancelled";
  return status.replace(/_/g, " ");
}

function statusClass(status: string): string {
  if (status === "completed") return "border-emerald-400/40 bg-emerald-500/10 text-emerald-200";
  if (status === "cancelled" || status === "vendor_timeout") return "border-rose-400/40 bg-rose-500/10 text-rose-100";
  if (status === "pickup_ready") return "border-blue-400/40 bg-blue-500/10 text-blue-100";
  if (status === "vendor_pending") return "border-amber-400/40 bg-amber-500/10 text-amber-100";
  return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
}

function orderCreatedMs(order: TakeoutOrder): number {
  const value = new Date(clean(order.created_at || order.updated_at)).getTime();
  return Number.isFinite(value) ? value : 0;
}

function pendingAcceptRemainingMs(order: TakeoutOrder): number {
  if (normalizedStatus(order) !== "vendor_pending") return 0;
  const created = orderCreatedMs(order);
  if (!created) return VENDOR_ACCEPT_WINDOW_MS;
  return Math.max(0, VENDOR_ACCEPT_WINDOW_MS - (Date.now() - created));
}

async function getJson(url: string): Promise<ApiResult> {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(clean(body?.message || body?.error || `HTTP ${response.status}`));
  }
  return body as ApiResult;
}

async function postJson(url: string, payload: Record<string, unknown>): Promise<ApiResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(clean(body?.message || body?.error || `HTTP ${response.status}`));
  }
  return body as ApiResult;
}

export default function VendorOrdersPage() {
  const [vendorId, setVendorId] = useState("");
  const [orders, setOrders] = useState<TakeoutOrder[]>([]);
  const [view, setView] = useState<OrderView>("active");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [savingId, setSavingId] = useState("");
  const [rejectOrder, setRejectOrder] = useState<TakeoutOrder | null>(null);
  const [rejectReason, setRejectReason] = useState<string>(VENDOR_REJECT_REASONS[0]);
  const [rejectOther, setRejectOther] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const soundUnlockedRef = useRef(false);
  const alertTimerRef = useRef<number | null>(null);
  const initialViewResolvedRef = useRef(false);

  useEffect(() => {
    const id = readVendorId();
    if (!id) {
      window.location.replace("/vendor-login");
      return;
    }
    persistVendorId(id);
    setVendorId(id);
    try {
      setSoundEnabled(window.localStorage.getItem(LS_VENDOR_SOUND_ENABLED) === "1");
    } catch {
      // Ignore restricted storage.
    }
  }, []);

  const activeOrders = useMemo(
    () => orders.filter((order) => !isHistoryStatus(normalizedStatus(order))).sort((a, b) => orderCreatedMs(b) - orderCreatedMs(a)),
    [orders],
  );

  const historyOrders = useMemo(
    () => orders.filter((order) => isHistoryStatus(normalizedStatus(order))).sort((a, b) => orderCreatedMs(b) - orderCreatedMs(a)),
    [orders],
  );

  const completedCount = useMemo(
    () => historyOrders.filter((order) => normalizedStatus(order) === "completed").length,
    [historyOrders],
  );

  const cancelledCount = useMemo(
    () => historyOrders.filter((order) => normalizedStatus(order) === "cancelled").length,
    [historyOrders],
  );

  const timeoutCount = useMemo(
    () => historyOrders.filter((order) => normalizedStatus(order) === "vendor_timeout").length,
    [historyOrders],
  );

  const pendingOrders = useMemo(
    () => activeOrders.filter((order) => normalizedStatus(order) === "vendor_pending" && pendingAcceptRemainingMs(order) > 0),
    [activeOrders],
  );

  const loadOrders = useCallback(async (silent = false) => {
    const id = clean(vendorId || readVendorId());
    if (!id) return;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const data = await getJson("/api/vendor-orders?vendor_id=" + encodeURIComponent(id));
      const list = Array.isArray(data.orders) ? data.orders : [];
      setOrders(list);
      setLastUpdated(new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }).format(new Date()));

      if (!initialViewResolvedRef.current) {
        const activeCount = list.filter((order) => !isHistoryStatus(normalizedStatus(order))).length;
        const historyCount = list.length - activeCount;
        if (activeCount === 0 && historyCount > 0) setView("history");
        initialViewResolvedRef.current = true;
      }
    } catch (err: any) {
      setError(clean(err?.message || err || "Could not load vendor orders."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vendorId]);

  useEffect(() => {
    if (!vendorId) return;
    void loadOrders(false);
    const timer = window.setInterval(() => void loadOrders(true), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadOrders, vendorId]);

  const stopAlertLoop = useCallback(() => {
    if (alertTimerRef.current !== null) {
      window.clearInterval(alertTimerRef.current);
      alertTimerRef.current = null;
    }
  }, []);

  const playAlert = useCallback(async () => {
    if (!soundEnabled || !soundUnlockedRef.current || !audioRef.current) return;
    try {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.volume = 1;
      await audioRef.current.play();
    } catch {
      // Android can require one explicit user interaction before audio plays.
    }
  }, [soundEnabled]);

  useEffect(() => {
    stopAlertLoop();
    if (!soundEnabled || !soundUnlockedRef.current || pendingOrders.length === 0) return;
    const started = Date.now();
    void playAlert();
    alertTimerRef.current = window.setInterval(() => {
      if (Date.now() - started >= VENDOR_ALERT_MAX_MS) {
        stopAlertLoop();
        return;
      }
      void playAlert();
    }, VENDOR_ALERT_REPEAT_MS);
    return stopAlertLoop;
  }, [pendingOrders.length, playAlert, soundEnabled, stopAlertLoop]);

  async function enableSound() {
    soundUnlockedRef.current = true;
    setSoundEnabled(true);
    try {
      window.localStorage.setItem(LS_VENDOR_SOUND_ENABLED, "1");
    } catch {
      // Ignore restricted storage.
    }
    if (audioRef.current) {
      try {
        audioRef.current.volume = 1;
        audioRef.current.currentTime = 0;
        await audioRef.current.play();
      } catch {
        // The next real order will retry after this user interaction.
      }
    }
  }

  function disableSound() {
    stopAlertLoop();
    soundUnlockedRef.current = false;
    setSoundEnabled(false);
    try {
      window.localStorage.setItem(LS_VENDOR_SOUND_ENABLED, "0");
    } catch {
      // Ignore restricted storage.
    }
  }

  async function acceptOrder(order: TakeoutOrder) {
    const id = orderId(order);
    if (!vendorId || !id || savingId) return;
    setSavingId(id);
    setError("");
    try {
      await postJson("/api/vendor-orders", {
        vendor_id: vendorId,
        order_id: id,
        vendor_status: "vendor_accepted",
      });
      await loadOrders(true);
    } catch (err: any) {
      setError(clean(err?.message || err || "Could not accept this order."));
    } finally {
      setSavingId("");
    }
  }

  async function confirmReject() {
    if (!rejectOrder || !vendorId || savingId) return;
    const id = orderId(rejectOrder);
    const reason = rejectReason === "Other" ? clean(rejectOther) : clean(rejectReason);
    if (!id || !reason) return;
    setSavingId(id);
    setError("");
    try {
      await postJson("/api/vendor-orders", {
        vendor_id: vendorId,
        order_id: id,
        vendor_status: "cancelled",
        cancel_reason: reason,
        vendor_cancel_reason: reason,
      });
      setRejectOrder(null);
      setRejectOther("");
      setRejectReason(VENDOR_REJECT_REASONS[0]);
      await loadOrders(true);
    } catch (err: any) {
      setError(clean(err?.message || err || "Could not reject this order."));
    } finally {
      setSavingId("");
    }
  }

  const visibleOrders = view === "active" ? activeOrders : historyOrders;

  return (
    <main className="min-h-screen bg-[#061014] text-slate-100" style={{ paddingTop: "max(52px, calc(env(safe-area-inset-top, 0px) + 8px))" }}>
      <audio ref={audioRef} src={VENDOR_ALERT_SOUND_URL} preload="auto" className="hidden" />

      <div className="sticky top-[44px] z-40 border-b border-emerald-500/20 bg-[#061014]/95 px-3 py-2 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
          <a href="/vendor-portal" className="rounded-xl border border-emerald-500/30 bg-slate-950 px-3 py-2 text-xs font-bold text-emerald-100">Back to portal</a>
          <div className="text-center">
            <div className="text-sm font-black">Vendor Orders</div>
            <div className="text-[10px] text-slate-400">Auto-refresh every 10 seconds</div>
          </div>
          <button
            type="button"
            onClick={() => void loadOrders(true)}
            disabled={refreshing}
            className="rounded-xl border border-emerald-500/30 bg-slate-950 px-3 py-2 text-xs font-bold text-emerald-100 disabled:opacity-50"
          >
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-4 px-3 py-4 sm:px-4">
        <section className="rounded-2xl border border-emerald-500/25 bg-slate-950/70 p-4 shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-300">JRide Takeout</div>
              <h1 className="mt-1 text-2xl font-black text-white">Orders</h1>
              <div className="mt-1 text-xs text-slate-400">
                {lastUpdated ? "Last updated " + lastUpdated : loading ? "Loading orders..." : "Waiting for update"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void (soundEnabled ? disableSound() : enableSound())}
              className={
                "rounded-xl border px-3 py-2 text-xs font-black " +
                (soundEnabled
                  ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                  : "border-slate-600 bg-slate-900 text-slate-300")
              }
            >
              {soundEnabled ? "Sound ON" : "Enable sound"}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3">
              <div className="text-[10px] font-bold uppercase text-slate-400">Active</div>
              <div className="mt-1 text-2xl font-black text-white">{activeOrders.length}</div>
            </div>
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3">
              <div className="text-[10px] font-bold uppercase text-emerald-300">Completed</div>
              <div className="mt-1 text-2xl font-black text-emerald-100">{completedCount}</div>
            </div>
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-3">
              <div className="text-[10px] font-bold uppercase text-rose-200">Cancelled</div>
              <div className="mt-1 text-2xl font-black text-rose-100">{cancelledCount}</div>
            </div>
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
              <div className="text-[10px] font-bold uppercase text-amber-200">Timeouts</div>
              <div className="mt-1 text-2xl font-black text-amber-100">{timeoutCount}</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-slate-700 bg-slate-900/70 p-1.5">
            <button
              type="button"
              onClick={() => setView("active")}
              className={
                "rounded-lg px-3 py-2.5 text-sm font-black " +
                (view === "active" ? "bg-emerald-500 text-slate-950" : "text-slate-300")
              }
            >
              Active ({activeOrders.length})
            </button>
            <button
              type="button"
              onClick={() => setView("history")}
              className={
                "rounded-lg px-3 py-2.5 text-sm font-black " +
                (view === "history" ? "bg-emerald-500 text-slate-950" : "text-slate-300")
              }
            >
              History ({historyOrders.length})
            </button>
          </div>

          {pendingOrders.length > 0 ? (
            <div className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-100">
              {pendingOrders.length} order{pendingOrders.length === 1 ? "" : "s"} waiting for vendor confirmation.
            </div>
          ) : null}
          {error ? <div className="mt-3 rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-100">{error}</div> : null}
        </section>

        {loading && orders.length === 0 ? (
          <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5 text-sm text-slate-400">Loading orders...</div>
        ) : visibleOrders.length === 0 ? (
          <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5 text-sm text-slate-300">
            {view === "active" ? "No active orders right now." : "No completed, cancelled, or timed-out orders yet."}
          </div>
        ) : (
          <section className="space-y-3">
            {visibleOrders.map((order) => {
              const id = orderId(order);
              const status = normalizedStatus(order);
              const items = Array.isArray(order.items) ? order.items : [];
              const saving = savingId === id;
              const remainingMs = pendingAcceptRemainingMs(order);
              const remainingSeconds = Math.ceil(remainingMs / 1000);
              const remainingLabel = `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")}`;

              return (
                <article key={id || orderCode(order)} className="rounded-2xl border border-emerald-500/20 bg-slate-950/70 p-4 shadow-lg">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-black text-white">{orderCode(order)}</div>
                        <span className={"rounded-full border px-2 py-1 text-[10px] font-black " + statusClass(status)}>{statusLabel(status)}</span>
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-200">{clean(order.customer_name || order.passenger_name) || "Customer"}</div>
                      {clean(order.customer_phone) ? <div className="text-xs text-slate-400">{clean(order.customer_phone)}</div> : null}
                      <div className="mt-1 text-xs text-slate-400">{clean(order.to_label || order.dropoff_label) || "Delivery address not shown"}</div>
                      <div className="mt-1 text-[10px] text-slate-500">{formatPhilippineDateTime(order.created_at || order.updated_at)}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[10px] uppercase text-slate-500">Subtotal</div>
                      <div className="text-base font-black text-white">{money(order.items_subtotal ?? order.total_bill)}</div>
                    </div>
                  </div>

                  {status === "vendor_pending" && remainingMs > 0 ? (
                    <div className="mt-3 inline-flex rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-xs font-black text-amber-100">
                      Accept within {remainingLabel}
                    </div>
                  ) : null}

                  <div className="mt-3 rounded-xl border border-slate-700 bg-slate-900/70 p-3">
                    <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Items</div>
                    {items.length === 0 ? (
                      <div className="mt-2 text-xs text-slate-500">No item snapshot saved for this order.</div>
                    ) : (
                      <div className="mt-2 divide-y divide-slate-700">
                        {items.map((item, index) => {
                          const qty = Math.max(1, Number(item.quantity ?? 1) || 1);
                          const price = Number(item.price ?? 0) || 0;
                          return (
                            <div key={index} className="flex items-center justify-between gap-3 py-2 text-sm">
                              <div>
                                <div className="font-semibold text-slate-100">{qty} x {clean(item.name) || "Item"}</div>
                                <div className="text-[10px] text-slate-500">{money(price)} each</div>
                              </div>
                              <div className="font-bold text-slate-200">{money(qty * price)}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {clean(order.customer_note || order.passenger_note || order.note) ? (
                    <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100">
                      <span className="font-black">Customer note: </span>{clean(order.customer_note || order.passenger_note || order.note)}
                    </div>
                  ) : null}

                  {status === "vendor_pending" ? (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void acceptOrder(order)}
                        className="rounded-xl bg-emerald-500 px-3 py-2.5 text-xs font-black text-slate-950 disabled:opacity-50"
                      >
                        {saving ? "Saving..." : "Accept order"}
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          setRejectOrder(order);
                          setRejectReason(VENDOR_REJECT_REASONS[0]);
                          setRejectOther("");
                        }}
                        className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2.5 text-xs font-black text-rose-100 disabled:opacity-50"
                      >
                        Reject order
                      </button>
                    </div>
                  ) : status === "vendor_accepted" || status === "driver_assigned" || status === "driver_accepted" ? (
                    <div className="mt-3 rounded-xl border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-100">
                      Order accepted. Follow the live workflow in the Vendor Portal for driver and customer confirmation before preparation.
                    </div>
                  ) : null}
                </article>
              );
            })}
          </section>
        )}
      </div>

      {rejectOrder ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-950 p-5 text-slate-100 shadow-2xl">
            <div className="text-lg font-black">Reject {orderCode(rejectOrder)}</div>
            <div className="mt-1 text-xs text-slate-400">A reason is required and will be saved with the cancellation.</div>

            <label className="mt-4 block text-xs font-bold text-slate-300">Reason</label>
            <select
              value={rejectReason}
              onChange={(event) => {
                setRejectReason(event.target.value);
                if (event.target.value !== "Other") setRejectOther("");
              }}
              className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-3 text-sm text-white"
            >
              {VENDOR_REJECT_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
            </select>

            {rejectReason === "Other" ? (
              <input
                value={rejectOther}
                onChange={(event) => setRejectOther(event.target.value)}
                placeholder="Type reason"
                className="mt-3 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-3 text-sm text-white"
              />
            ) : null}

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRejectOrder(null)}
                className="rounded-xl border border-slate-600 px-3 py-2.5 text-xs font-black text-slate-200"
              >
                Keep order
              </button>
              <button
                type="button"
                disabled={!!savingId || (rejectReason === "Other" && !clean(rejectOther))}
                onClick={() => void confirmReject()}
                className="rounded-xl bg-rose-600 px-3 py-2.5 text-xs font-black text-white disabled:opacity-50"
              >
                {savingId ? "Saving..." : "Confirm reject"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
