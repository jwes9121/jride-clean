"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const VENDOR_ID_KEYS = [
  "JRIDE_VENDOR_PORTAL_VENDOR_ID",
  "jride_vendor_id",
  "JRIDE_VENDOR_ID",
  "vendor_id",
] as const;

type MissedOrder = {
  id: string;
  booking_code: string;
  customer_name: string;
  amount: number;
  outcome: string;
  reason: string;
  order_placed_at: string | null;
  missed_at: string | null;
  exact_event_at?: string | null;
  expected_deadline_at?: string | null;
  date_is_exact: boolean;
  time_label?: string;
  timestamp_note?: string;
  timeout_window_minutes?: number | null;
};

type VendorSummary = {
  vendor_id: string;
  display_name: string;
  town: string | null;
  metrics_started_at: string;
  days: number;
  current_state: "online" | "open_but_offline" | "closed";
  last_seen_at: string | null;
  presence_client: string | null;
  online_hours: number;
  offered: number;
  accepted: number;
  completed: number;
  accepted_not_completed: number;
  unaccepted: number;
  timed_out: number;
  rejected: number;
  pending: number;
  acceptance_rate: number | null;
  average_response_seconds: number | null;
  survey_responses: number;
  survey_average: number | null;
  missed_orders: MissedOrder[];
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function readVendorId(): string {
  if (typeof window === "undefined") return "";
  for (const key of VENDOR_ID_KEYS) {
    const values = [
      window.sessionStorage.getItem(key),
      window.localStorage.getItem(key),
    ];
    for (const value of values) {
      const id = clean(value);
      if (id) return id;
    }
  }
  return "";
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
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

function formatMoney(value: number): string {
  return "PHP " + Number(value || 0).toFixed(2);
}

function formatResponseSeconds(value: number | null): string {
  if (value === null) return "Not enough data";
  if (value < 60) return String(value) + " sec";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return String(minutes) + " min " + String(seconds) + " sec";
}

function stateLabel(value: VendorSummary["current_state"]): string {
  if (value === "online") return "ONLINE";
  if (value === "open_but_offline") return "OPEN BUT OFFLINE";
  return "CLOSED";
}

function stateClass(value: VendorSummary["current_state"]): string {
  if (value === "online") {
    return "border-emerald-400 bg-emerald-500/15 text-emerald-200";
  }
  if (value === "open_but_offline") {
    return "border-amber-400 bg-amber-500/15 text-amber-100";
  }
  return "border-slate-500 bg-slate-700/60 text-slate-200";
}

function SmallStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-slate-950/60 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-xl font-black text-white">{value}</div>
    </div>
  );
}

export default function VendorPerformancePanel() {
  const pathname = usePathname();
  const [vendorId, setVendorId] = useState("");
  const [summary, setSummary] = useState<VendorSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(id: string, silent = false) {
    if (!id) return;
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await fetch(
        "/api/vendor-performance/summary?vendor_id=" +
          encodeURIComponent(id) +
          "&days=30",
        { cache: "no-store" }
      );
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.ok !== true || !json?.vendor) {
        throw new Error(
          json?.message || json?.error || "Failed to load store statistics."
        );
      }
      setSummary(json.vendor as VendorSummary);
    } catch (loadError: any) {
      setError(
        String(
          loadError?.message ||
            loadError ||
            "Failed to load store statistics."
        )
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    if (pathname !== "/vendor-portal") {
      setVendorId("");
      setSummary(null);
      setOpen(false);
      return;
    }

    let stopped = false;
    let discoveryTimer: number | null = null;
    let refreshTimer: number | null = null;

    const discover = () => {
      if (stopped) return;
      const id = readVendorId();
      if (!id) {
        discoveryTimer = window.setTimeout(discover, 1500);
        return;
      }

      setVendorId(id);
      void load(id, true);
      refreshTimer = window.setInterval(() => void load(id, true), 60000);
    };

    discover();

    return () => {
      stopped = true;
      if (discoveryTimer !== null) window.clearTimeout(discoveryTimer);
      if (refreshTimer !== null) window.clearInterval(refreshTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (pathname !== "/vendor-portal" || !vendorId) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void load(vendorId, false);
        }}
        className="fixed bottom-4 right-4 z-[65] rounded-full border border-emerald-300 bg-slate-950 px-4 py-3 text-sm font-black text-emerald-100 shadow-2xl hover:border-emerald-200"
      >
        Store stats
        {summary?.unaccepted ? (
          <span className="ml-2 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] text-white">
            {summary.unaccepted} missed
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
          <section className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-emerald-500/30 bg-slate-950 p-4 text-slate-100 shadow-2xl sm:max-w-5xl sm:rounded-3xl sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">
                  Vendor profile statistics
                </div>
                <h2 className="mt-1 text-2xl font-black text-white">
                  {summary?.display_name || "Store performance"}
                </h2>
                <div className="mt-1 text-xs text-slate-400">
                  Real orders only. Known test accounts and explicitly excluded
                  bookings are not counted.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-slate-600 px-4 py-2 text-sm font-bold text-white hover:border-emerald-400"
              >
                Close
              </button>
            </div>

            {loading ? (
              <div className="mt-4 rounded-xl border border-slate-700 p-4 text-sm text-slate-300">
                Loading store statistics...
              </div>
            ) : null}

            {error ? (
              <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm font-semibold text-rose-100">
                {error}
              </div>
            ) : null}

            {summary ? (
              <>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={
                      "rounded-full border px-3 py-1 font-black " +
                      stateClass(summary.current_state)
                    }
                  >
                    {stateLabel(summary.current_state)}
                  </span>
                  <span className="text-slate-400">
                    Last seen: {formatDateTime(summary.last_seen_at)}
                  </span>
                  <span className="text-slate-400">
                    Metrics started: {formatDateTime(summary.metrics_started_at)}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
                  <SmallStat label="Orders offered" value={summary.offered} />
                  <SmallStat label="Accepted" value={summary.accepted} />
                  <SmallStat label="Completed" value={summary.completed} />
                  <SmallStat label="Unaccepted" value={summary.unaccepted} />
                  <SmallStat label="Pending" value={summary.pending} />
                  <SmallStat
                    label="Acceptance rate"
                    value={
                      summary.acceptance_rate === null
                        ? "Building"
                        : summary.acceptance_rate + "%"
                    }
                  />
                  <SmallStat label="Timed out" value={summary.timed_out} />
                  <SmallStat label="Rejected" value={summary.rejected} />
                  <SmallStat
                    label="Average response"
                    value={formatResponseSeconds(
                      summary.average_response_seconds
                    )}
                  />
                  <SmallStat
                    label="Customer survey"
                    value={
                      summary.survey_average === null
                        ? "No survey yet"
                        : summary.survey_average.toFixed(1) + "/5"
                    }
                  />
                </div>

                <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-slate-900/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-black text-white">
                        Unaccepted orders and response deadlines
                      </h3>
                      <p className="mt-1 text-xs text-slate-400">
                        Exact event time is shown only when JRide captured the
                        actual timeout or rejection. For older records, JRide
                        shows the expected response deadline and labels it as
                        derived instead of pretending a later database update
                        was the missed-order time.
                      </p>
                    </div>
                    <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs font-bold text-rose-100">
                      {summary.missed_orders.length} listed
                    </span>
                  </div>

                  {summary.missed_orders.length === 0 ? (
                    <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-300">
                      No real unaccepted order exists after the new metrics
                      baseline.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {summary.missed_orders.map((order) => (
                        <div
                          key={order.id}
                          className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-xs"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="font-black text-white">
                                {order.booking_code}
                              </div>
                              <div className="mt-1 text-slate-300">
                                {order.customer_name} | {formatMoney(order.amount)}
                              </div>
                            </div>
                            <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-1 font-bold text-rose-100">
                              {order.outcome}
                            </span>
                          </div>

                          <div className="mt-2 grid grid-cols-1 gap-1 text-slate-400 sm:grid-cols-2">
                            <div>
                              <span className="font-semibold text-slate-300">
                                Order placed:
                              </span>{" "}
                              {formatDateTime(order.order_placed_at)}
                            </div>
                            <div>
                              <span className="font-semibold text-slate-300">
                                {order.time_label ||
                                  (order.date_is_exact
                                    ? "Event time"
                                    : "Recorded time")}
                                :
                              </span>{" "}
                              {formatDateTime(order.missed_at)}
                            </div>
                          </div>

                          <div
                            className={
                              "mt-2 rounded-lg border p-2 text-[11px] " +
                              (order.date_is_exact
                                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
                                : "border-amber-500/30 bg-amber-500/10 text-amber-100")
                            }
                          >
                            {order.timestamp_note ||
                              (order.date_is_exact
                                ? "Exact event time"
                                : "Historical exact event time unavailable")}
                          </div>

                          <div className="mt-2 text-slate-300">
                            <span className="font-semibold">Reason:</span>{" "}
                            {order.reason}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
