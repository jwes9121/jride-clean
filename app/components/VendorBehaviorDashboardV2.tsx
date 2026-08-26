"use client";

import React, { useEffect, useMemo, useState } from "react";

type MissedOrder = {
  id: string;
  booking_code: string;
  passenger_name: string;
  amount: number;
  outcome: string;
  reason: string;
  order_placed_at: string | null;
  missed_at: string | null;
  exact_event_at: string | null;
  expected_deadline_at: string | null;
  date_is_exact: boolean;
  time_label: string;
  timestamp_note: string;
  timeout_window_minutes: number | null;
};

type VendorRow = {
  vendor_id: string;
  display_name: string;
  email: string | null;
  town: string | null;
  marketplace_status: string;
  vendor_group: string;
  current_state: "online" | "open_but_offline" | "closed";
  last_seen_at: string | null;
  presence_client: string | null;
  heartbeat_tracking_started_at: string | null;
  online_hours_tracked: number;
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
  average_daily_completed: number;
  average_daily_unaccepted: number;
  average_weekly_completed: number;
  average_weekly_unaccepted: number;
  average_monthly_completed: number;
  average_monthly_unaccepted: number;
  recent_missed_orders: MissedOrder[];
};

type ApiData = {
  ok: boolean;
  days: number;
  cohort: string;
  generated_at: string;
  order_history_note: string;
  presence_note: string;
  cohort_counts: Record<string, number>;
  vendors: VendorRow[];
};

function formatDate(value: string | null | undefined) {
  if (!value) return "Never";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

function responseText(seconds: number | null) {
  if (seconds === null) return "Not enough data";
  if (seconds < 60) return `${seconds} sec`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
}

function stateLabel(state: VendorRow["current_state"]) {
  if (state === "online") return "ONLINE";
  if (state === "open_but_offline") return "OPEN BUT OFFLINE";
  return "CLOSED";
}

function stateClass(state: VendorRow["current_state"]) {
  if (state === "online") {
    return "border-emerald-300 bg-emerald-50 text-emerald-800";
  }
  if (state === "open_but_offline") {
    return "border-amber-300 bg-amber-50 text-amber-900";
  }
  return "border-slate-300 bg-slate-100 text-slate-700";
}

function timeQualityClass(order: MissedOrder) {
  if (order.date_is_exact) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (order.expected_deadline_at) {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function timeQualityLabel(order: MissedOrder) {
  if (order.date_is_exact) return "Exact event time";
  if (order.expected_deadline_at) return "Derived deadline";
  return "Recorded update time";
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white p-3 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-xl font-black text-slate-950">{value}</div>
    </div>
  );
}

export default function VendorBehaviorDashboardV2() {
  const [data, setData] = useState<ApiData | null>(null);
  const [days, setDays] = useState(30);
  const [cohort, setCohort] = useState("pilot_active");
  const [town, setTown] = useState("");
  const [state, setState] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ days: String(days), cohort });
      if (town) qs.set("town", town);
      const res = await fetch(
        `/api/admin/vendor-behavior-v2?${qs.toString()}`,
        { cache: "no-store" }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j?.ok !== true) {
        throw new Error(
          j?.message || j?.error || "Failed to load vendor behavior."
        );
      }
      setData(j as ApiData);
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to load."));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), 60000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, cohort, town]);

  const towns = ["Lagawe", "Hingyon", "Banaue", "Lamut", "Kiangan"];

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.vendors || []).filter((v) => {
      if (state !== "all" && v.current_state !== state) return false;
      if (!q) return true;
      return [v.display_name, v.email, v.town, v.vendor_id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [data, search, state]);

  const totals = useMemo(
    () => ({
      vendors: visible.length,
      online: visible.filter((v) => v.current_state === "online").length,
      openOffline: visible.filter(
        (v) => v.current_state === "open_but_offline"
      ).length,
      closed: visible.filter((v) => v.current_state === "closed").length,
      offered: visible.reduce((n, v) => n + v.offered, 0),
      completed: visible.reduce((n, v) => n + v.completed, 0),
      unaccepted: visible.reduce((n, v) => n + v.unaccepted, 0),
    }),
    [visible]
  );

  return (
    <main className="min-h-screen bg-slate-100 p-3 sm:p-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                JRide Admin
              </div>
              <h1 className="mt-1 text-2xl font-black">
                Vendor online behavior and order statistics
              </h1>
              <p className="mt-1 max-w-4xl text-sm text-slate-600">
                Admin order statistics use real Takeout history inside the
                selected range. Public vendor-profile metrics still start from
                the new public baseline and remain separate.
              </p>
            </div>
            <button
              onClick={() => void load(false)}
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-5">
            <label className="text-xs font-bold text-slate-600">
              Vendor group
              <select
                value={cohort}
                onChange={(e) => setCohort(e.target.value)}
                className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm"
              >
                <option value="pilot_active">
                  Pilot / Active ({data?.cohort_counts?.pilot_active ?? "-"})
                </option>
                <option value="batch2">
                  Batch 2 ({data?.cohort_counts?.batch2 ?? "-"})
                </option>
                <option value="all">All active groups</option>
                <option value="removed">
                  Removed ({data?.cohort_counts?.removed ?? "-"})
                </option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">
              Reporting range
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm"
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
                <option value={365}>Last 365 days</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">
              Town
              <select
                value={town}
                onChange={(e) => setTown(e.target.value)}
                className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm"
              >
                <option value="">All towns</option>
                {towns.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">
              Current state
              <select
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm"
              >
                <option value="all">All states</option>
                <option value="online">Online</option>
                <option value="open_but_offline">Open but offline</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">
              Search vendor
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, email, town, vendor ID"
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              />
            </label>
          </div>

          {data ? (
            <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              <div>{data.order_history_note}</div>
              <div className="mt-1">{data.presence_note}</div>
              <div className="mt-1 text-blue-700">
                Generated: {formatDate(data.generated_at)}
              </div>
            </div>
          ) : null}
        </section>

        {error ? (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
            {error}
          </div>
        ) : null}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Stat label="Vendors" value={totals.vendors} />
          <Stat label="Online" value={totals.online} />
          <Stat label="Open but offline" value={totals.openOffline} />
          <Stat label="Closed" value={totals.closed} />
          <Stat label="Orders offered" value={totals.offered} />
          <Stat label="Completed" value={totals.completed} />
          <Stat label="Unaccepted" value={totals.unaccepted} />
        </section>

        <section className="space-y-3">
          {!loading && visible.length === 0 ? (
            <div className="rounded-2xl border bg-white p-5 text-sm text-slate-600">
              No vendors match this group and filters.
            </div>
          ) : null}
          {visible.map((v) => (
            <article
              key={v.vendor_id}
              className="rounded-2xl border bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-black">{v.display_name}</h2>
                    <span
                      className={`rounded-full border px-2 py-1 text-[10px] font-black ${stateClass(v.current_state)}`}
                    >
                      {stateLabel(v.current_state)}
                    </span>
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-black text-sky-800">
                      {v.vendor_group}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {v.town || "No town"} |{" "}
                    {v.marketplace_status || "unclassified"}
                  </div>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>Last seen: {formatDate(v.last_seen_at)}</div>
                  <div>Client: {v.presence_client || "No heartbeat yet"}</div>
                  <div>Tracked online hours: {v.online_hours_tracked} h</div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5 xl:grid-cols-10">
                <Stat label="Offered" value={v.offered} />
                <Stat label="Accepted" value={v.accepted} />
                <Stat label="Completed" value={v.completed} />
                <Stat
                  label="Accepted not completed"
                  value={v.accepted_not_completed}
                />
                <Stat label="Unaccepted" value={v.unaccepted} />
                <Stat label="Timed out" value={v.timed_out} />
                <Stat label="Rejected" value={v.rejected} />
                <Stat label="Pending" value={v.pending} />
                <Stat
                  label="Acceptance"
                  value={
                    v.acceptance_rate === null
                      ? "Not enough data"
                      : `${v.acceptance_rate}%`
                  }
                />
                <Stat
                  label="Avg response"
                  value={responseText(v.average_response_seconds)}
                />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                <div className="rounded-xl border bg-slate-50 p-3 text-xs">
                  <div className="font-bold">Daily average</div>
                  <div className="mt-1">
                    Completed: {v.average_daily_completed}
                  </div>
                  <div>Unaccepted: {v.average_daily_unaccepted}</div>
                </div>
                <div className="rounded-xl border bg-slate-50 p-3 text-xs">
                  <div className="font-bold">Weekly average</div>
                  <div className="mt-1">
                    Completed: {v.average_weekly_completed}
                  </div>
                  <div>Unaccepted: {v.average_weekly_unaccepted}</div>
                </div>
                <div className="rounded-xl border bg-slate-50 p-3 text-xs">
                  <div className="font-bold">Monthly average</div>
                  <div className="mt-1">
                    Completed: {v.average_monthly_completed}
                  </div>
                  <div>Unaccepted: {v.average_monthly_unaccepted}</div>
                  <div className="mt-1 text-slate-500">
                    Survey:{" "}
                    {v.survey_average === null
                      ? "No verified survey"
                      : `${v.survey_average}/5 (${v.survey_responses})`}
                  </div>
                </div>
              </div>

              <details className="mt-3 rounded-xl border bg-slate-50 p-3">
                <summary className="cursor-pointer text-sm font-bold">
                  Recent unaccepted orders and response deadlines ({v.recent_missed_orders.length})
                </summary>
                <div className="mt-2 space-y-2">
                  {v.recent_missed_orders.map((o) => (
                    <div
                      key={o.id}
                      className="rounded-lg border bg-white p-2 text-xs"
                    >
                      <div className="font-bold">
                        {o.booking_code} | {o.outcome}
                      </div>
                      <div className="mt-1">
                        Customer: {o.passenger_name} | PHP{" "}
                        {Number(o.amount || 0).toFixed(2)}
                      </div>
                      <div>Placed: {formatDate(o.order_placed_at)}</div>
                      <div>
                        {o.time_label ||
                          (o.date_is_exact
                            ? "Event time"
                            : "Recorded time")}
                        : {formatDate(o.missed_at)}
                      </div>
                      <div
                        className={`mt-1 rounded border px-2 py-1 text-[10px] ${timeQualityClass(o)}`}
                      >
                        <div className="font-bold uppercase">
                          {timeQualityLabel(o)}
                        </div>
                        <div className="mt-0.5 normal-case">
                          {o.timestamp_note ||
                            "No timestamp-quality note was returned."}
                        </div>
                      </div>
                      <div className="mt-1">Reason: {o.reason}</div>
                    </div>
                  ))}
                  {v.recent_missed_orders.length === 0 ? (
                    <div className="text-xs text-slate-500">
                      No real unaccepted orders in this range.
                    </div>
                  ) : null}
                </div>
              </details>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
