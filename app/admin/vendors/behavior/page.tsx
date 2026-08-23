"use client";

import React, { useEffect, useMemo, useState } from "react";

type PeriodAverage = {
  complete_periods: number;
  completed_orders: number | null;
  unaccepted_orders: number | null;
  online_hours: number | null;
  open_hours: number | null;
};

type OrderStats = {
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
};

type MissedOrder = {
  id: string;
  booking_code: string;
  passenger_name: string;
  amount: number;
  outcome: string;
  reason: string;
  order_placed_at: string | null;
  missed_at: string | null;
  date_is_exact: boolean;
};

type VendorBehavior = {
  vendor_id: string;
  display_name: string;
  email: string | null;
  town: string | null;
  accepting_orders: boolean;
  metrics_started_at: string;
  current_state: "online" | "open_but_offline" | "closed";
  last_seen_at: string | null;
  last_seen_age_seconds: number | null;
  presence_client: string | null;
  range: OrderStats & {
    days: number;
    starts_at: string;
    online_minutes: number;
    online_hours: number;
    open_minutes: number;
    open_hours: number;
    open_but_offline_minutes: number;
    open_but_offline_hours: number;
    orders_per_online_hour: number | null;
  };
  today: OrderStats;
  last_7_days: OrderStats;
  last_30_days: OrderStats;
  averages: {
    daily: PeriodAverage;
    weekly: PeriodAverage;
    monthly: PeriodAverage;
  };
  survey: {
    responses: number;
    average: number | null;
  };
  recent_missed_orders: MissedOrder[];
};

type TestAccount = {
  id: string;
  subject_id: string;
  reason: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
};

type BookingExclusion = {
  id: string;
  booking_id: string;
  booking_code: string | null;
  passenger_name: string | null;
  vendor_id: string | null;
  reason: string;
};

type ApiData = {
  ok: boolean;
  days: number;
  generated_at: string;
  online_fresh_seconds: number;
  vendors: VendorBehavior[];
  exclusions: {
    test_accounts: TestAccount[];
    bookings: BookingExclusion[];
  };
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function numberText(value: number | null | undefined, suffix = ""): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "Not enough data";
  }
  return String(value) + suffix;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
}

function formatMoney(value: number): string {
  return "PHP " + Number(value || 0).toFixed(2);
}

function formatSeconds(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Not enough data";
  if (value < 60) return String(value) + " sec";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return String(minutes) + " min " + String(seconds) + " sec";
}

function stateLabel(state: VendorBehavior["current_state"]): string {
  if (state === "online") return "ONLINE";
  if (state === "open_but_offline") return "OPEN BUT OFFLINE";
  return "CLOSED";
}

function stateClass(state: VendorBehavior["current_state"]): string {
  if (state === "online") {
    return "border-emerald-300 bg-emerald-50 text-emerald-800";
  }
  if (state === "open_but_offline") {
    return "border-amber-300 bg-amber-50 text-amber-900";
  }
  return "border-slate-300 bg-slate-100 text-slate-700";
}

function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-black text-slate-950">{value}</div>
      {note ? <div className="mt-1 text-xs text-slate-500">{note}</div> : null}
    </div>
  );
}

function AverageCell({ title, value }: { title: string; value: PeriodAverage }) {
  return (
    <div className="rounded-xl border bg-slate-50 p-3 text-xs">
      <div className="font-bold text-slate-900">{title}</div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-600">
        <span>Complete periods</span>
        <span className="text-right font-semibold text-slate-900">
          {value.complete_periods}
        </span>
        <span>Completed</span>
        <span className="text-right font-semibold text-slate-900">
          {numberText(value.completed_orders)}
        </span>
        <span>Unaccepted</span>
        <span className="text-right font-semibold text-slate-900">
          {numberText(value.unaccepted_orders)}
        </span>
        <span>Online hours</span>
        <span className="text-right font-semibold text-slate-900">
          {numberText(value.online_hours, " h")}
        </span>
        <span>Open hours</span>
        <span className="text-right font-semibold text-slate-900">
          {numberText(value.open_hours, " h")}
        </span>
      </div>
    </div>
  );
}

export default function VendorBehaviorPage() {
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [days, setDays] = useState(30);
  const [search, setSearch] = useState("");
  const [town, setTown] = useState("all");
  const [state, setState] = useState("all");
  const [writeBusy, setWriteBusy] = useState(false);
  const [writeMessage, setWriteMessage] = useState("");
  const [passengerId, setPassengerId] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [reason, setReason] = useState("Controlled JRide test account or booking");

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await fetch(
        "/api/admin/vendor-behavior?days=" + encodeURIComponent(String(days)),
        { cache: "no-store" }
      );
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.ok !== true) {
        throw new Error(json?.message || json?.error || "Failed to load vendor behavior.");
      }
      setData(json as ApiData);
    } catch (loadError: any) {
      setError(String(loadError?.message || loadError || "Failed to load."));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), 60000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  async function writeExclusion(action: string, payload: Record<string, any>) {
    setWriteBusy(true);
    setWriteMessage("");
    try {
      const response = await fetch("/api/admin/vendor-behavior", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reason,
          marked_by: "JRide admin dashboard",
          ...payload,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.ok !== true) {
        throw new Error(json?.message || json?.error || "Update failed.");
      }
      setWriteMessage("Saved. Metrics were recalculated without deleting any booking.");
      if (action.includes("passenger")) setPassengerId("");
      if (action.includes("booking")) setBookingId("");
      await load(true);
    } catch (writeError: any) {
      setWriteMessage(String(writeError?.message || writeError || "Update failed."));
    } finally {
      setWriteBusy(false);
    }
  }

  const towns = useMemo(() => {
    const values = new Set<string>();
    for (const vendor of data?.vendors || []) {
      if (vendor.town) values.add(vendor.town);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const visibleVendors = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.vendors || []).filter((vendor) => {
      if (town !== "all" && vendor.town !== town) return false;
      if (state !== "all" && vendor.current_state !== state) return false;
      if (!query) return true;
      const haystack = [
        vendor.display_name,
        vendor.email,
        vendor.town,
        vendor.vendor_id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [data, search, town, state]);

  const totals = useMemo(() => {
    const rows = data?.vendors || [];
    return {
      vendors: rows.length,
      online: rows.filter((row) => row.current_state === "online").length,
      openOffline: rows.filter(
        (row) => row.current_state === "open_but_offline"
      ).length,
      closed: rows.filter((row) => row.current_state === "closed").length,
      completed: rows.reduce((sum, row) => sum + row.range.completed, 0),
      unaccepted: rows.reduce((sum, row) => sum + row.range.unaccepted, 0),
      offered: rows.reduce((sum, row) => sum + row.range.offered, 0),
    };
  }, [data]);

  return (
    <main className="min-h-screen bg-slate-100 p-3 sm:p-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <header className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
                JRide Admin
              </div>
              <h1 className="mt-1 text-2xl font-black text-slate-950">
                Vendor online behavior and order statistics
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                Metrics begin at each vendor's new performance baseline. Explicit test accounts and excluded bookings remain in operations history but are removed from these figures.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href="/admin/vendors"
                className="rounded-xl border bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Back to vendors
              </a>
              <button
                type="button"
                onClick={() => void load(false)}
                disabled={loading}
                className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {loading ? "Loading..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-[180px_1fr_180px_220px]">
            <label className="text-xs font-bold text-slate-600">
              Reporting range
              <select
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
                className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm"
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
                <option value={365}>Last 365 days</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">
              Search vendor
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, email, town, or vendor ID"
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Town
              <select
                value={town}
                onChange={(event) => setTown(event.target.value)}
                className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm"
              >
                <option value="all">All towns</option>
                {towns.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">
              Current state
              <select
                value={state}
                onChange={(event) => setState(event.target.value)}
                className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm"
              >
                <option value="all">All states</option>
                <option value="online">Online</option>
                <option value="open_but_offline">Open but offline</option>
                <option value="closed">Closed</option>
              </select>
            </label>
          </div>

          {data ? (
            <div className="mt-3 text-xs text-slate-500">
              Generated: {formatDateTime(data.generated_at)} | Online means a portal heartbeat was received within {data.online_fresh_seconds} seconds.
            </div>
          ) : null}
        </header>

        {error ? (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
            {error}
          </div>
        ) : null}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <StatCard label="Vendors" value={totals.vendors} />
          <StatCard label="Online" value={totals.online} />
          <StatCard label="Open but offline" value={totals.openOffline} />
          <StatCard label="Closed" value={totals.closed} />
          <StatCard label="Orders offered" value={totals.offered} />
          <StatCard label="Completed" value={totals.completed} />
          <StatCard label="Unaccepted" value={totals.unaccepted} />
        </section>

        <section className="space-y-3">
          {loading && !data ? (
            <div className="rounded-2xl border bg-white p-6 text-sm text-slate-600">
              Loading vendor behavior...
            </div>
          ) : null}

          {!loading && visibleVendors.length === 0 ? (
            <div className="rounded-2xl border bg-white p-6 text-sm text-slate-600">
              No vendor matches the current filters.
            </div>
          ) : null}

          {visibleVendors.map((vendor) => (
            <article
              key={vendor.vendor_id}
              className="rounded-2xl border bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-black text-slate-950">
                      {vendor.display_name}
                    </h2>
                    <span
                      className={
                        "rounded-full border px-2.5 py-1 text-[11px] font-black " +
                        stateClass(vendor.current_state)
                      }
                    >
                      {stateLabel(vendor.current_state)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {vendor.town || "Town not set"} | {vendor.email || "No email"}
                  </div>
                  <div className="mt-1 break-all font-mono text-[10px] text-slate-400">
                    {vendor.vendor_id}
                  </div>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>Last seen: {formatDateTime(vendor.last_seen_at)}</div>
                  <div>Client: {vendor.presence_client || "No heartbeat yet"}</div>
                  <div>Metrics start: {formatDateTime(vendor.metrics_started_at)}</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5 xl:grid-cols-10">
                <StatCard label="Offered" value={vendor.range.offered} />
                <StatCard label="Accepted" value={vendor.range.accepted} />
                <StatCard label="Completed" value={vendor.range.completed} />
                <StatCard
                  label="Accepted not completed"
                  value={vendor.range.accepted_not_completed}
                />
                <StatCard label="Unaccepted" value={vendor.range.unaccepted} />
                <StatCard label="Timed out" value={vendor.range.timed_out} />
                <StatCard label="Rejected" value={vendor.range.rejected} />
                <StatCard label="Pending" value={vendor.range.pending} />
                <StatCard
                  label="Acceptance"
                  value={numberText(vendor.range.acceptance_rate, "%")}
                />
                <StatCard
                  label="Avg response"
                  value={formatSeconds(vendor.range.average_response_seconds)}
                />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-4">
                <div className="rounded-xl border bg-slate-50 p-3 text-xs">
                  <div className="font-bold text-slate-900">Presence in selected range</div>
                  <div className="mt-2 grid grid-cols-2 gap-y-1 text-slate-600">
                    <span>Online hours</span>
                    <span className="text-right font-semibold text-slate-900">
                      {vendor.range.online_hours} h
                    </span>
                    <span>Open hours</span>
                    <span className="text-right font-semibold text-slate-900">
                      {vendor.range.open_hours} h
                    </span>
                    <span>Open but offline</span>
                    <span className="text-right font-semibold text-amber-800">
                      {vendor.range.open_but_offline_hours} h
                    </span>
                    <span>Orders per online hour</span>
                    <span className="text-right font-semibold text-slate-900">
                      {numberText(vendor.range.orders_per_online_hour)}
                    </span>
                    <span>Survey</span>
                    <span className="text-right font-semibold text-slate-900">
                      {vendor.survey.average === null
                        ? "No verified survey"
                        : vendor.survey.average.toFixed(1) + "/5 (" + vendor.survey.responses + ")"}
                    </span>
                  </div>
                </div>
                <AverageCell title="Average per complete day" value={vendor.averages.daily} />
                <AverageCell title="Average per complete week" value={vendor.averages.weekly} />
                <AverageCell title="Average per complete month" value={vendor.averages.monthly} />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                <div className="rounded-xl border p-3 text-xs">
                  <div className="font-bold text-slate-900">Today</div>
                  <div className="mt-1 text-slate-600">
                    {vendor.today.offered} offered | {vendor.today.completed} completed | {vendor.today.unaccepted} unaccepted
                  </div>
                </div>
                <div className="rounded-xl border p-3 text-xs">
                  <div className="font-bold text-slate-900">Last 7 days</div>
                  <div className="mt-1 text-slate-600">
                    {vendor.last_7_days.offered} offered | {vendor.last_7_days.completed} completed | {vendor.last_7_days.unaccepted} unaccepted
                  </div>
                </div>
                <div className="rounded-xl border p-3 text-xs">
                  <div className="font-bold text-slate-900">Last 30 days</div>
                  <div className="mt-1 text-slate-600">
                    {vendor.last_30_days.offered} offered | {vendor.last_30_days.completed} completed | {vendor.last_30_days.unaccepted} unaccepted
                  </div>
                </div>
              </div>

              <details className="mt-3 rounded-xl border bg-slate-50 p-3">
                <summary className="cursor-pointer text-sm font-bold text-slate-900">
                  Recent missed or rejected orders ({vendor.recent_missed_orders.length})
                </summary>
                {vendor.recent_missed_orders.length === 0 ? (
                  <div className="mt-2 text-xs text-slate-500">
                    No real unaccepted order exists after this vendor's metrics baseline.
                  </div>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead>
                        <tr className="border-b text-slate-500">
                          <th className="px-2 py-2">Order</th>
                          <th className="px-2 py-2">Customer</th>
                          <th className="px-2 py-2">Outcome</th>
                          <th className="px-2 py-2">Reason</th>
                          <th className="px-2 py-2">Placed</th>
                          <th className="px-2 py-2">Missed at</th>
                          <th className="px-2 py-2">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vendor.recent_missed_orders.map((order) => (
                          <tr key={order.id} className="border-b last:border-0">
                            <td className="px-2 py-2 font-mono font-semibold">
                              {order.booking_code}
                            </td>
                            <td className="px-2 py-2">{order.passenger_name}</td>
                            <td className="px-2 py-2">{order.outcome}</td>
                            <td className="max-w-xs px-2 py-2">{order.reason}</td>
                            <td className="whitespace-nowrap px-2 py-2">
                              {formatDateTime(order.order_placed_at)}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2">
                              {formatDateTime(order.missed_at)}
                              <div className="text-[10px] text-slate-400">
                                {order.date_is_exact ? "Exact event time" : "Recorded update time"}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-2 py-2">
                              {formatMoney(order.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            </article>
          ))}
        </section>

        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div>
            <h2 className="text-lg font-black text-slate-950">
              Explicit dummy and test exclusions
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Use exact UUIDs. Do not exclude by partial name matching. Exclusion never deletes the account, order, or audit history.
            </p>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-xl border bg-slate-50 p-3">
              <div className="text-sm font-bold text-slate-900">Exclude passenger account</div>
              <input
                value={passengerId}
                onChange={(event) => setPassengerId(event.target.value)}
                placeholder="Passenger user UUID"
                className="mt-2 w-full rounded-xl border bg-white px-3 py-2 font-mono text-xs"
              />
              <button
                type="button"
                disabled={writeBusy || !clean(passengerId)}
                onClick={() =>
                  void writeExclusion("exclude_passenger", {
                    subject_id: passengerId,
                  })
                }
                className="mt-2 rounded-xl bg-slate-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                Exclude account from metrics
              </button>
            </div>

            <div className="rounded-xl border bg-slate-50 p-3">
              <div className="text-sm font-bold text-slate-900">Exclude one booking</div>
              <input
                value={bookingId}
                onChange={(event) => setBookingId(event.target.value)}
                placeholder="Booking UUID"
                className="mt-2 w-full rounded-xl border bg-white px-3 py-2 font-mono text-xs"
              />
              <button
                type="button"
                disabled={writeBusy || !clean(bookingId)}
                onClick={() =>
                  void writeExclusion("exclude_booking", {
                    booking_id: bookingId,
                  })
                }
                className="mt-2 rounded-xl bg-slate-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                Exclude booking from metrics
              </button>
            </div>
          </div>

          <label className="mt-3 block text-xs font-bold text-slate-600">
            Audit reason
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            />
          </label>

          {writeMessage ? (
            <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs font-semibold text-blue-900">
              {writeMessage}
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Excluded passenger accounts ({data?.exclusions.test_accounts.length || 0})
              </h3>
              <div className="mt-2 space-y-2">
                {(data?.exclusions.test_accounts || []).map((row) => (
                  <div key={row.id} className="rounded-xl border p-3 text-xs">
                    <div className="font-bold text-slate-900">
                      {row.full_name || row.email || row.subject_id}
                    </div>
                    <div className="mt-1 break-all font-mono text-[10px] text-slate-500">
                      {row.subject_id}
                    </div>
                    <div className="mt-1 text-slate-600">{row.reason}</div>
                    <button
                      type="button"
                      disabled={writeBusy}
                      onClick={() =>
                        void writeExclusion("include_passenger", {
                          subject_id: row.subject_id,
                        })
                      }
                      className="mt-2 rounded-lg border px-3 py-1.5 font-bold text-slate-700"
                    >
                      Restore to metrics
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Excluded bookings ({data?.exclusions.bookings.length || 0})
              </h3>
              <div className="mt-2 space-y-2">
                {(data?.exclusions.bookings || []).map((row) => (
                  <div key={row.id} className="rounded-xl border p-3 text-xs">
                    <div className="font-bold text-slate-900">
                      {row.booking_code || row.booking_id}
                    </div>
                    <div className="mt-1 break-all font-mono text-[10px] text-slate-500">
                      {row.booking_id}
                    </div>
                    <div className="mt-1 text-slate-600">{row.reason}</div>
                    <button
                      type="button"
                      disabled={writeBusy}
                      onClick={() =>
                        void writeExclusion("include_booking", {
                          booking_id: row.booking_id,
                        })
                      }
                      className="mt-2 rounded-lg border px-3 py-1.5 font-bold text-slate-700"
                    >
                      Restore to metrics
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
