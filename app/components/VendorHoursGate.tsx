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

function elementText(element: Element | null): string {
  return clean(element?.textContent).replace(/\s+/g, " ");
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
  if (!status.manual_accepting_orders) return "Closed by the vendor for today.";
  if (status.reason === "daily_open_required") return "Store has not been opened for orders today.";
  if (status.reason === "within_hours") return "Open for customer orders.";
  if (status.reason === "extended") return "Open under today's extension.";
  if (status.reason === "outside_hours") return "Closed by today's normal operating schedule.";
  return status.effective_accepting_orders ? "Open for customer orders." : "Closed for new customer orders.";
}

function retireLegacyAvailabilityUi() {
  const shell = document.querySelector<HTMLElement>(".jride-vendor-premium-shell");
  if (!shell) return;

  const profileSection = Array.from(shell.querySelectorAll<HTMLElement>("section")).find((section) => {
    return elementText(section.querySelector("h2")) === "Vendor profile";
  });
  if (!profileSection) return;

  const directChildren = Array.from(profileSection.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );

  const legacyAvailabilityPanel = directChildren.find((child) => {
    const text = elementText(child);
    return text.includes("Order availability") && text.includes("OPEN FOR ORDERS") && text.includes("CLOSED");
  });
  if (legacyAvailabilityPanel) {
    legacyAvailabilityPanel.dataset.jrideLegacyAvailabilityRetired = "true";
    legacyAvailabilityPanel.style.display = "none";
    legacyAvailabilityPanel.setAttribute("aria-hidden", "true");
  }

  const profileHeader = directChildren.find((child) => elementText(child.querySelector("h2")) === "Vendor profile");
  if (profileHeader) {
    const legacyBadge = Array.from(profileHeader.children).find((child) => {
      const text = elementText(child);
      return text === "Open" || text === "Closed";
    });
    if (legacyBadge instanceof HTMLElement) {
      legacyBadge.dataset.jrideLegacyAvailabilityRetired = "true";
      legacyBadge.style.display = "none";
      legacyBadge.setAttribute("aria-hidden", "true");
    }

    const subtitle = profileHeader.querySelector("p");
    if (subtitle && elementText(subtitle) === "Store identity and live order availability.") {
      subtitle.textContent = "Store identity and profile details.";
    }
  }
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
    if (pathname !== "/vendor-portal") return;

    let frame = 0;
    const apply = () => retireLegacyAvailabilityUi();
    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(apply);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pathname]);

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

        if (action === "close_today") {
          setDailyPromptDismissed(true);
          setPanelOpen(false);
        }

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

  const canCloseToday = Boolean(status?.daily_opened && status?.manual_accepting_orders);

  if (pathname !== "/vendor-portal" || !vendorId) return null;

  return (
    <div
      className="relative z-[50] border-b border-emerald-500/20 bg-slate-950 text-slate-100 shadow-lg"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 8px)" }}
    >
      <div className="mx-auto max-w-7xl space-y-2 px-3 pb-3 sm:px-4">
        {!status && error ? (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm font-semibold text-rose-100">
            Store hours could not be loaded: {error}
          </div>
        ) : null}

        {status && needsHours ? (
          <section className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-300">Store hours setup required</div>
                <div className="mt-1 text-base font-black text-white">Set your normal opening and closing time</div>
                <p className="mt-1 text-xs leading-5 text-slate-300">
                  Customer ordering stays closed until business hours are saved and the store is opened for the day. You can still edit your profile, menu, prices, photos, stock, and pickup location while the store is closed.
                </p>
              </div>
              <a href="/vendor-faq" className="shrink-0 text-xs font-bold text-amber-200 underline">
                Vendor FAQ
              </a>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-xs font-semibold text-slate-200">
                Opening
                <input
                  type="time"
                  value={openTime}
                  onChange={(e) => setOpenTime(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="text-xs font-semibold text-slate-200">
                Closing
                <input
                  type="time"
                  value={closeTime}
                  onChange={(e) => setCloseTime(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                />
              </label>
            </div>

            {!validDraftHours ? (
              <div className="mt-2 text-[11px] font-semibold text-rose-200">Closing must be later than opening on the same day.</div>
            ) : null}

            {error ? <div className="mt-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-100">{error}</div> : null}

            <button
              type="button"
              disabled={busy || !validDraftHours}
              onClick={() => void postAction("save_hours", { normal_open_time: openTime, normal_close_time: closeTime })}
              className="mt-3 w-full rounded-xl bg-amber-300 px-4 py-2.5 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Saving..." : "Save business hours"}
            </button>
          </section>
        ) : null}

        {status && !needsHours ? (
          <section className="rounded-2xl border border-emerald-500/25 bg-slate-900/90 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${
                      status.effective_accepting_orders
                        ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                        : "border-rose-400/50 bg-rose-500/15 text-rose-100"
                    }`}
                  >
                    {status.effective_accepting_orders ? "OPEN" : "CLOSED"}
                  </span>
                  <span className="text-sm font-black text-white">Store status</span>
                </div>
                <div className="mt-1 text-xs text-slate-300">{statusText(status)}</div>
                <div className="mt-1 text-[11px] text-slate-400">
                  Normal hours: {formatClock(status.normal_open_time)} - {formatClock(status.normal_close_time)}
                  {extensionScheduled ? ` | Extended until ${formatManilaDateTime(status.extended_until)}` : ""}
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                {canCloseToday ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("Close this store for new orders today?")) {
                        void postAction("close_today");
                      }
                    }}
                    className="rounded-xl border border-rose-400/50 bg-rose-500/10 px-3 py-2 text-xs font-black text-rose-100 disabled:opacity-50"
                  >
                    CLOSE TODAY
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPanelOpen((value) => !value)}
                  className="rounded-xl border border-emerald-500/40 bg-slate-950 px-3 py-2 text-xs font-black text-emerald-100 hover:border-emerald-300"
                >
                  {panelOpen ? "Hide hours" : "Manage hours"}
                </button>
              </div>
            </div>

            {shouldPromptDailyOpen ? (
              <div className="mt-3 rounded-xl border border-blue-400/40 bg-blue-500/10 p-3">
                <div className="text-sm font-black text-blue-100">Your store is offline today.</div>
                <div className="mt-1 text-xs leading-5 text-slate-300">
                  Open it only when you are ready to receive Takeout orders. This notice does not block menu or profile editing.
                  {timing.beforeOpen ? " Customer ordering will begin at your normal opening time." : ""}
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void postAction("open_today")}
                    className="rounded-xl bg-emerald-500 px-3 py-2.5 text-xs font-black text-slate-950 disabled:opacity-50"
                  >
                    {busy ? "Opening..." : "OPEN FOR ORDERS TODAY"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDailyPromptDismissed(true)}
                    className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 text-xs font-black text-slate-200 disabled:opacity-50"
                  >
                    STAY OFFLINE
                  </button>
                </div>
              </div>
            ) : null}

            {shouldPromptForClosing ? (
              <div className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3">
                <div className="font-black text-amber-100">Your normal closing time is approaching.</div>
                <div className="mt-1 text-xs text-amber-100/90">
                  Closing time: {formatClock(status.normal_close_time)}. JRide will stop new orders automatically at closing time unless an extension is active.
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void postAction("extend", { minutes: 30 })}
                    className="rounded-lg bg-amber-300 px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-50"
                  >
                    Extend 30 min
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void postAction("extend", { minutes: 60 })}
                    className="rounded-lg bg-amber-300 px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-50"
                  >
                    Extend 60 min
                  </button>
                  <button
                    type="button"
                    onClick={() => setDismissedCloseAt(clean(status.scheduled_close_at))}
                    className="rounded-lg border border-amber-400/50 bg-slate-950 px-3 py-2 text-xs font-black text-amber-100"
                  >
                    Close on schedule
                  </button>
                </div>
              </div>
            ) : null}

            {panelOpen ? (
              <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950/80 p-3">
                <div className="grid gap-1 text-xs text-slate-300 sm:grid-cols-3">
                  <div><span className="font-bold text-white">Opened today:</span> {status.daily_opened ? "YES" : "NO"}</div>
                  <div><span className="font-bold text-white">Customer ordering:</span> {status.effective_accepting_orders ? "OPEN" : "CLOSED"}</div>
                  <div><span className="font-bold text-white">Reason:</span> {status.reason || "unavailable"}</div>
                </div>

                {!status.daily_opened && !timing.afterClose ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void postAction("open_today")}
                    className="mt-3 w-full rounded-lg bg-emerald-500 px-3 py-2.5 text-xs font-black text-slate-950 disabled:opacity-50"
                  >
                    OPEN FOR ORDERS TODAY
                  </button>
                ) : null}

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="text-xs font-semibold text-slate-300">
                    Opening
                    <input
                      type="time"
                      value={openTime}
                      onChange={(e) => setOpenTime(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-white"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-300">
                    Closing
                    <input
                      type="time"
                      value={closeTime}
                      onChange={(e) => setCloseTime(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-white"
                    />
                  </label>
                </div>
                {!validDraftHours ? <div className="mt-1 text-[11px] font-semibold text-rose-200">Closing must be later than opening on the same day.</div> : null}

                <button
                  type="button"
                  disabled={busy || !validDraftHours}
                  onClick={() => void postAction("save_hours", { normal_open_time: openTime, normal_close_time: closeTime })}
                  className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-xs font-black text-white disabled:opacity-50"
                >
                  {busy ? "Saving..." : "Save normal hours"}
                </button>

                {canShowExtensionControls ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void postAction("extend", { minutes: 30 })}
                      className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                    >
                      Extend 30 min
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void postAction("extend", { minutes: 60 })}
                      className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                    >
                      Extend 60 min
                    </button>
                  </div>
                ) : null}

                {extensionScheduled ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void postAction("end_extension")}
                    className="mt-2 w-full rounded-lg border border-rose-400/50 bg-rose-500/10 px-3 py-2 text-xs font-black text-rose-100 disabled:opacity-50"
                  >
                    Cancel today's extension
                  </button>
                ) : null}

                {error ? <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-100">{error}</div> : null}

                <a href="/vendor-faq" className="mt-3 block text-center text-xs font-black text-blue-200 underline">
                  Vendor FAQ
                </a>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
