"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const VENDOR_ID_KEYS = [
  "JRIDE_VENDOR_PORTAL_VENDOR_ID",
  "jride_vendor_id",
  "JRIDE_VENDOR_ID",
  "vendor_id",
] as const;

type HoursStatus = {
  ok: boolean;
  vendor_id: string;
  display_name: string;
  timezone: string;
  effective_accepting_orders: boolean;
  manual_accepting_orders: boolean;
  hours_enforced: boolean;
  hours_configured: boolean;
  normal_open_time: string | null;
  normal_close_time: string | null;
  extended_from: string | null;
  extended_until: string | null;
  extension_active: boolean;
  scheduled_open_at: string | null;
  scheduled_close_at: string | null;
  daily_opened: boolean;
  daily_open_date: string | null;
  daily_opened_at: string | null;
  reason: string;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function readVendorId(): string {
  if (typeof window === "undefined") return "";

  for (const key of VENDOR_ID_KEYS) {
    const values = [window.sessionStorage.getItem(key), window.localStorage.getItem(key)];
    for (const value of values) {
      const id = clean(value);
      if (id) return id;
    }
  }

  return "";
}

function formatClock(value: string | null): string {
  const raw = clean(value);
  if (!/^\d{2}:\d{2}$/.test(raw)) return "Not set";
  const [hourText, minute] = raw.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 || 12;
  return `${twelve}:${minute} ${suffix}`;
}

function formatManilaDateTime(value: string | null): string {
  const raw = clean(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function sameDayHoursValid(openTime: string, closeTime: string): boolean {
  return /^\d{2}:\d{2}$/.test(openTime) && /^\d{2}:\d{2}$/.test(closeTime) && openTime < closeTime;
}

function statusText(status: HoursStatus): string {
  if (!status.hours_enforced || !status.hours_configured) return "Opening and closing times are required.";
  if (status.reason === "daily_open_required") return "Store has not been opened for orders today.";
  if (!status.manual_accepting_orders) return "Closed by the vendor OPEN/CLOSED switch.";
  if (status.reason === "within_hours") return "Open for customer orders.";
  if (status.reason === "extended") return "Open under today's extension.";
  if (status.reason === "outside_hours") return "Closed by today's normal operating schedule.";
  return status.effective_accepting_orders ? "Open for customer orders." : "Closed for new customer orders.";
}

async function readJson(res: Response): Promise<any> {
  return res.json().catch(() => ({}));
}

export default function VendorHoursGate() {
  const pathname = usePathname();
  const [vendorId, setVendorId] = useState("");
  const [status, setStatus] = useState<HoursStatus | null>(null);
  const [openTime, setOpenTime] = useState("");
  const [closeTime, setCloseTime] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dismissedCloseAt, setDismissedCloseAt] = useState("");
  const [dailyPromptDismissed, setDailyPromptDismissed] = useState(false);
  const [clockTick, setClockTick] = useState(0);

  useEffect(() => {
    if (pathname !== "/vendor-portal") {
      setVendorId("");
      setStatus(null);
      return;
    }

    let stopped = false;
    let timer: number | null = null;

    const discover = () => {
      if (stopped) return;
      const id = readVendorId();
      if (id) {
        setVendorId(id);
        return;
      }
      timer = window.setTimeout(discover, 1500);
    };

    discover();
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [pathname]);

  const loadStatus = useCallback(async () => {
    if (!vendorId) return;
    const res = await fetch(`/api/vendor-hours?vendor_id=${encodeURIComponent(vendorId)}`, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const data = await readJson(res);
    if (!res.ok || data?.ok === false) {
      throw new Error(clean(data?.message || data?.error || `HTTP ${res.status}`));
    }
    setStatus(data as HoursStatus);
    setOpenTime((current) => current || clean(data?.normal_open_time));
    setCloseTime((current) => current || clean(data?.normal_close_time));
  }, [vendorId]);

  useEffect(() => {
    if (!vendorId || pathname !== "/vendor-portal") return;

    let stopped = false;
    const run = async () => {
      try {
        await loadStatus();
        if (!stopped) setError("");
      } catch (e: any) {
        if (!stopped) setError(clean(e?.message || e || "Could not load store hours."));
      }
    };

    void run();
    const poll = window.setInterval(() => void run(), 30000);
    const tick = window.setInterval(() => setClockTick((value) => value + 1), 15000);
    return () => {
      stopped = true;
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [loadStatus, pathname, vendorId]);

  useEffect(() => {
    if (!status) return;
    setOpenTime(clean(status.normal_open_time));
    setCloseTime(clean(status.normal_close_time));
    if (status.daily_opened) setDailyPromptDismissed(false);
  }, [status?.vendor_id, status?.normal_open_time, status?.normal_close_time, status?.daily_opened]);

  const postAction = useCallback(
    async (action: string, extra: Record<string, any> = {}) => {
      if (!vendorId || busy) return;
      setBusy(true);
      setError("");
      try {
        const res = await fetch("/api/vendor-hours", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ vendor_id: vendorId, action, ...extra }),
        });
        const data = await readJson(res);
        if (!res.ok || data?.ok === false) {
          throw new Error(clean(data?.message || data?.error || `HTTP ${res.status}`));
        }
        setStatus(data as HoursStatus);
        setOpenTime(clean(data?.normal_open_time));
        setCloseTime(clean(data?.normal_close_time));

        if (action === "open_today" && typeof window !== "undefined") {
          window.setTimeout(() => window.location.reload(), 150);
        }
      } catch (e: any) {
        setError(clean(e?.message || e || "Store hours could not be updated."));
      } finally {
        setBusy(false);
      }
    },
    [busy, vendorId],
  );

  const needsHours = Boolean(status && (!status.hours_configured || !status.hours_enforced));
  const validDraftHours = sameDayHoursValid(openTime, closeTime);

  const extensionScheduled = useMemo(() => {
    if (!status?.extended_until) return false;
    const until = new Date(status.extended_until).getTime();
    return Number.isFinite(until) && until > Date.now();
  }, [clockTick, status?.extended_until]);

  const timing = useMemo(() => {
    const openMs = status?.scheduled_open_at ? new Date(status.scheduled_open_at).getTime() : NaN;
    const closeMs = status?.scheduled_close_at ? new Date(status.scheduled_close_at).getTime() : NaN;
    const now = Date.now();
    const untilClose = Number.isFinite(closeMs) ? closeMs - now : NaN;

    return {
      beforeOpen: Number.isFinite(openMs) && now < openMs,
      afterClose: Number.isFinite(closeMs) && now >= closeMs,
      nearClose:
        Number.isFinite(untilClose) &&
        untilClose <= 30 * 60 * 1000 &&
        untilClose >= -5 * 60 * 1000,
    };
  }, [clockTick, status?.scheduled_open_at, status?.scheduled_close_at]);

  const shouldPromptDailyOpen = Boolean(
    status &&
      !needsHours &&
      !status.daily_opened &&
      !timing.afterClose &&
      !dailyPromptDismissed,
  );

  const shouldPromptForClosing = useMemo(() => {
    if (!status?.daily_opened || !status?.effective_accepting_orders || !status?.scheduled_close_at || extensionScheduled) return false;
    if (dismissedCloseAt === status.scheduled_close_at) return false;
    const closeMs = new Date(status.scheduled_close_at).getTime();
    if (!Number.isFinite(closeMs)) return false;
    const remaining = closeMs - Date.now();
    return remaining > 0 && remaining <= 15 * 60 * 1000;
  }, [clockTick, dismissedCloseAt, extensionScheduled, status]);

  const canShowExtensionControls = Boolean(
    status?.daily_opened && status?.manual_accepting_orders && (timing.nearClose || extensionScheduled),
  );

  if (pathname !== "/vendor-portal" || !vendorId) return null;

  return (
    <>
      {status && needsHours ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-lg rounded-3xl border bg-white p-5 shadow-2xl">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Required setup</div>
            <h2 className="mt-1 text-xl font-bold text-slate-950">Set your normal opening and closing time</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              JRide uses these times to stop new customer orders automatically when your normal business day ends. Times use Philippine time.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-800">
                Normal opening time
                <input
                  type="time"
                  value={openTime}
                  onChange={(e) => setOpenTime(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-base"
                />
              </label>
              <label className="text-sm font-semibold text-slate-800">
                Normal closing time
                <input
                  type="time"
                  value={closeTime}
                  onChange={(e) => setCloseTime(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-base"
                />
              </label>
            </div>

            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              Closing time must be later than opening time on the same day. Overnight business hours are not enabled. After saving, the store remains OFFLINE until you manually open for orders that day.
            </div>

            {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

            <button
              type="button"
              disabled={busy || !validDraftHours}
              onClick={() => void postAction("save_hours", { normal_open_time: openTime, normal_close_time: closeTime })}
              className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Saving..." : "Save business hours"}
            </button>

            <a href="/vendor-faq" className="mt-3 block text-center text-sm font-semibold text-blue-700 underline">
              Read the Vendor FAQ
            </a>
          </div>
        </div>
      ) : null}

      {status && shouldPromptDailyOpen ? (
        <div className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-3xl border bg-white p-5 shadow-2xl">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Daily store status</div>
            <h2 className="mt-1 text-xl font-bold text-slate-950">Your store is OFFLINE today</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              JRide does not automatically reopen your store each day. Open the Vendor Portal and turn the store on only when you are ready to receive Takeout orders.
            </p>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              Normal hours: <span className="font-semibold">{formatClock(status.normal_open_time)} - {formatClock(status.normal_close_time)}</span>
              {timing.beforeOpen ? <div className="mt-1 text-xs">You may turn it on now. Customer ordering will begin only at your normal opening time.</div> : null}
            </div>

            {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

            <button
              type="button"
              disabled={busy}
              onClick={() => void postAction("open_today")}
              className="mt-5 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? "Opening..." : "OPEN FOR ORDERS TODAY"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDailyPromptDismissed(true)}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 disabled:opacity-50"
            >
              STAY OFFLINE
            </button>
          </div>
        </div>
      ) : null}

      {status && !needsHours && shouldPromptForClosing ? (
        <div className="fixed left-1/2 top-4 z-[160] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-xl">
          <div className="font-bold text-amber-950">Your normal closing time is approaching.</div>
          <div className="mt-1 text-sm text-amber-900">
            Closing time: {formatClock(status.normal_close_time)}. If you do nothing, JRide will stop new orders automatically at closing time.
          </div>
          <div className="mt-1 text-xs text-amber-800">Extend only when your store can legally remain open and local curfew rules allow it.</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void postAction("extend", { minutes: 30 })}
              className="rounded-xl bg-amber-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              Extend 30 minutes
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void postAction("extend", { minutes: 60 })}
              className="rounded-xl bg-amber-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              Extend 60 minutes
            </button>
            <button
              type="button"
              onClick={() => setDismissedCloseAt(clean(status.scheduled_close_at))}
              className="rounded-xl border border-amber-400 bg-white px-3 py-2 text-xs font-bold text-amber-950"
            >
              Close on schedule
            </button>
          </div>
        </div>
      ) : null}

      {status && !needsHours ? (
        <div className="fixed bottom-4 left-4 z-[120] max-w-[calc(100%-2rem)]">
          {panelOpen ? (
            <div className="mb-2 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-slate-300 bg-white p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-slate-950">Store hours</div>
                  <div className="mt-1 text-xs text-slate-600">{statusText(status)}</div>
                </div>
                <button type="button" onClick={() => setPanelOpen(false)} className="rounded-lg border px-2 py-1 text-xs font-bold text-slate-600">
                  Close
                </button>
              </div>

              <div className="mt-3 rounded-xl border bg-slate-50 p-3 text-sm">
                <div><span className="font-semibold">Normal hours:</span> {formatClock(status.normal_open_time)} - {formatClock(status.normal_close_time)}</div>
                <div className="mt-1"><span className="font-semibold">Opened today:</span> {status.daily_opened ? "YES" : "NO"}</div>
                <div className="mt-1"><span className="font-semibold">Customer ordering:</span> {status.effective_accepting_orders ? "OPEN" : "CLOSED"}</div>
                {extensionScheduled ? (
                  <div className="mt-1"><span className="font-semibold">Extension:</span> until {formatManilaDateTime(status.extended_until)}</div>
                ) : null}
              </div>

              {!status.daily_opened && !timing.afterClose ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void postAction("open_today")}
                  className="mt-3 w-full rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                  OPEN FOR ORDERS TODAY
                </button>
              ) : null}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold text-slate-700">
                  Opening
                  <input type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm" />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Closing
                  <input type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm" />
                </label>
              </div>
              {!validDraftHours ? <div className="mt-1 text-[11px] text-rose-700">Closing must be later than opening on the same day.</div> : null}

              <button
                type="button"
                disabled={busy || !validDraftHours}
                onClick={() => void postAction("save_hours", { normal_open_time: openTime, normal_close_time: closeTime })}
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 disabled:opacity-50"
              >
                Save normal hours
              </button>

              {canShowExtensionControls ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" disabled={busy} onClick={() => void postAction("extend", { minutes: 30 })} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                    Extend 30 min
                  </button>
                  <button type="button" disabled={busy} onClick={() => void postAction("extend", { minutes: 60 })} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                    Extend 60 min
                  </button>
                </div>
              ) : null}

              {extensionScheduled ? (
                <button type="button" disabled={busy} onClick={() => void postAction("end_extension")} className="mt-2 w-full rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 disabled:opacity-50">
                  Cancel today's extension
                </button>
              ) : null}

              {error ? <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">{error}</div> : null}

              <a href="/vendor-faq" className="mt-3 block text-center text-xs font-bold text-blue-700 underline">
                Vendor FAQ
              </a>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setPanelOpen((value) => !value)}
            className={`rounded-full border px-4 py-2 text-xs font-bold shadow-lg ${status.effective_accepting_orders ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-rose-300 bg-rose-50 text-rose-900"}`}
          >
            Store hours: {status.effective_accepting_orders ? "OPEN" : "CLOSED"}
          </button>
        </div>
      ) : null}
    </>
  );
}
