"use client";

import React, { useEffect, useMemo, useState } from "react";

type Period = "today" | "week" | "month" | "all";

type MissedOrder = {
  booking_id: string;
  booking_code: string;
  passenger_id: string | null;
  passenger_name: string;
  outcome: "timeout" | "rejected";
  reason: string;
  order_placed_at: string | null;
  recorded_at: string | null;
  recorded_at_exact: boolean;
};

type VendorBehavior = {
  vendor_id: string;
  display_name: string;
  town: string;
  accepting_orders: boolean;
  test_vendor: boolean;
  metrics_started_at: string;
  current_state: "online" | "open_but_offline" | "closed";
  last_seen_at: string | null;
  last_seen_surface: string | null;
  offered_orders: number;
  accepted_orders: number;
  completed_orders: number;
  accepted_not_completed: number;
  unaccepted_orders: number;
  vendor_timeouts: number;
  vendor_rejections: number;
  pending_orders: number;
  other_closed_orders: number;
  acceptance_rate: number | null;
  average_response_seconds: number | null;
  online_hours: number;
  eligible_vendor_surveys: number;
  vendor_rating_average: number | null;
  excluded_test_orders: number;
  averages_since_baseline: Record<string, number>;
  missed_orders: MissedOrder[];
};

function formatManila(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
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

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "-";
  if (seconds < 60) return Math.round(seconds) + " sec";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return minutes + " min" + (remainder ? " " + remainder + " sec" : "");
}

function stateLabel(state: VendorBehavior["current_state"]): string {
  if (state === "online") return "ONLINE";
  if (state === "open_but_offline") return "OPEN BUT OFFLINE";
  return "CLOSED";
}

function stateClass(state: VendorBehavior["current_state"]): string {
  if (state === "online") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (state === "open_but_offline") return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-slate-300 bg-slate-100 text-slate-700";
}

function number(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function VendorBehaviorPage() {
  const [period, setPeriod] = useState<Period>("today");
  const [vendors, setVendors] = useState<VendorBehavior[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  async function load(nextPeriod: Period = period) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/vendor-behavior?period=" + encodeURIComponent(nextPeriod), {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        throw new Error(body?.message || body?.error || "Failed to load vendor behavior.");
      }
      setVendors(Array.isArray(body?.vendors) ? body.vendors : []);
      setGeneratedAt(body?.generated_at || null);
    } catch (reason: any) {
      setError(String(reason?.message || reason || "Failed to load vendor behavior."));
      setVendors([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(period);
    const timer = window.setInterval(() => void load(period), 60000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return vendors;
    return vendors.filter((vendor) =>
      [vendor.display_name, vendor.town, vendor.vendor_id, vendor.current_state]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [vendors, search]);

  const totals = useMemo(() => {
    return visible.reduce(
      (sum, vendor) => {
        sum.offered += number(vendor.offered_orders);
        sum.completed += number(vendor.completed_orders);
        sum.unaccepted += number(vendor.unaccepted_orders);
        sum.online += vendor.current_state === "online" ? 1 : 0;
        sum.openOffline += vendor.current_state === "open_but_offline" ? 1 : 0;
        return sum;
      },
      { offered: 0, completed: 0, unaccepted: 0, online: 0, openOffline: 0 }
    );
  }, [visible]);

  async function exclusionAction(action: string, payload: Record<string, any>, key: string) {
    const reason = action === "mark_passenger" || action === "exclude_booking"
      ? window.prompt("Reason for excluding this test data:", "Dummy/test transaction")
      : "";
    if ((action === "mark_passenger" || action === "exclude_booking") && !String(reason || "").trim()) return;

    setBusyKey(key);
    setError("");
    try {
      const response = await fetch("/api/admin/vendor-behavior/exclusions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: reason || undefined, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        throw new Error(body?.message || body?.error || "Exclusion update failed.");
      }
      await load(period);
    } catch (reasonValue: any) {
      setError(String(reasonValue?.message || reasonValue || "Exclusion update failed."));
    } finally {
      setBusyKey("");
    }
  }

  return (
    <main className="p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">JRide Admin</div>
              <h1 className="text-2xl font-black text-slate-950">Vendor Online Behavior</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                Exact post-baseline online-order behavior. Explicit dummy accounts and excluded test bookings are removed without deleting operational records.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load(period)}
              disabled={loading}
              className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(["today", "week", "month", "all"] as Period[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setPeriod(item)}
                className={[
                  "rounded-full border px-3 py-1.5 text-xs font-bold",
                  period === item ? "border-slate-950 bg-slate-950 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                {item === "today" ? "Today" : item === "week" ? "This week" : item === "month" ? "This month" : "Since baseline"}
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Metric label="Orders offered" value={totals.offered} />
            <Metric label="Completed" value={totals.completed} />
            <Metric label="Unaccepted" value={totals.unaccepted} />
            <Metric label="Online now" value={totals.online} />
            <Metric label="Open but offline" value={totals.openOffline} />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search vendor, town, UUID, or state"
              className="w-full max-w-xl rounded-xl border px-3 py-2 text-sm"
            />
            <div className="text-xs text-slate-500">
              Generated: {formatManila(generatedAt)}
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</div>
        ) : null}

        {!loading && visible.length === 0 ? (
          <div className="rounded-2xl border bg-white p-6 text-sm text-slate-600">No vendors matched this view.</div>
        ) : null}

        <div className="space-y-4">
          {visible.map((vendor) => {
            const isExpanded = expanded[vendor.vendor_id] === true;
            return (
              <section key={vendor.vendor_id} className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-black text-slate-950">{vendor.display_name}</h2>
                      <span className={["rounded-full border px-2.5 py-1 text-[11px] font-black", stateClass(vendor.current_state)].join(" ")}>
                        {stateLabel(vendor.current_state)}
                      </span>
                      {vendor.test_vendor ? (
                        <span className="rounded-full border border-violet-300 bg-violet-50 px-2.5 py-1 text-[11px] font-black text-violet-800">TEST VENDOR</span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{vendor.town || "Town not set"} | {vendor.vendor_id}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Baseline: {formatManila(vendor.metrics_started_at)} | Last seen: {formatManila(vendor.last_seen_at)} {vendor.last_seen_surface ? "(" + vendor.last_seen_surface + ")" : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpanded((current) => ({ ...current, [vendor.vendor_id]: !isExpanded }))}
                    className="rounded-xl border px-3 py-2 text-xs font-bold hover:bg-slate-50"
                  >
                    {isExpanded ? "Hide details" : "View details"}
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
                  <Metric label="Offered" value={vendor.offered_orders} compact />
                  <Metric label="Accepted" value={vendor.accepted_orders} compact />
                  <Metric label="Completed" value={vendor.completed_orders} compact />
                  <Metric label="Unaccepted" value={vendor.unaccepted_orders} compact />
                  <Metric label="Timeouts" value={vendor.vendor_timeouts} compact />
                  <Metric label="Rejections" value={vendor.vendor_rejections} compact />
                  <Metric label="Pending" value={vendor.pending_orders} compact />
                  <Metric label="Excluded tests" value={vendor.excluded_test_orders} compact />
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
                  <Info label="Acceptance rate" value={vendor.acceptance_rate === null ? "No decisions" : vendor.acceptance_rate.toFixed(1) + "%"} />
                  <Info label="Average response" value={formatDuration(vendor.average_response_seconds)} />
                  <Info label="Online hours" value={number(vendor.online_hours).toFixed(2)} />
                  <Info label="Vendor survey" value={vendor.vendor_rating_average === null ? "No eligible survey" : vendor.vendor_rating_average.toFixed(2) + " / 5 (" + vendor.eligible_vendor_surveys + ")"} />
                </div>

                {isExpanded ? (
                  <div className="mt-4 space-y-4 border-t pt-4">
                    <div>
                      <h3 className="text-sm font-black text-slate-900">Average behavior since baseline</h3>
                      <p className="mt-1 text-xs text-slate-500">Includes the current partial day, week, and month. This is admin-only and never shown on the customer storefront.</p>
                      <div className="mt-3 overflow-x-auto rounded-xl border">
                        <table className="min-w-full text-xs">
                          <thead className="bg-slate-50 text-left">
                            <tr>
                              <th className="px-3 py-2">Average</th>
                              <th className="px-3 py-2">Offered</th>
                              <th className="px-3 py-2">Completed</th>
                              <th className="px-3 py-2">Unaccepted</th>
                              <th className="px-3 py-2">Online hours</th>
                            </tr>
                          </thead>
                          <tbody>
                            <AverageRow label="Daily" data={vendor.averages_since_baseline} prefix="daily" />
                            <AverageRow label="Weekly" data={vendor.averages_since_baseline} prefix="weekly" />
                            <AverageRow label="Monthly" data={vendor.averages_since_baseline} prefix="monthly" />
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-sm font-black text-slate-900">Unaccepted orders</h3>
                      <p className="mt-1 text-xs text-slate-500">Only vendor timeouts and explicit pre-acceptance vendor rejections are counted here.</p>

                      {vendor.missed_orders.length === 0 ? (
                        <div className="mt-2 rounded-xl border bg-slate-50 p-3 text-sm text-slate-600">No unaccepted orders in this period.</div>
                      ) : (
                        <div className="mt-2 overflow-x-auto rounded-xl border">
                          <table className="min-w-full text-xs">
                            <thead className="bg-slate-50 text-left">
                              <tr>
                                <th className="px-3 py-2">Order</th>
                                <th className="px-3 py-2">Customer</th>
                                <th className="px-3 py-2">Outcome</th>
                                <th className="px-3 py-2">Order placed</th>
                                <th className="px-3 py-2">Recorded</th>
                                <th className="px-3 py-2">Screen test data</th>
                              </tr>
                            </thead>
                            <tbody>
                              {vendor.missed_orders.map((order) => (
                                <tr key={order.booking_id} className="border-t align-top">
                                  <td className="px-3 py-2 font-mono">{order.booking_code || order.booking_id}</td>
                                  <td className="px-3 py-2">
                                    <div className="font-semibold">{order.passenger_name}</div>
                                    <div className="mt-1 font-mono text-[10px] text-slate-500">{order.passenger_id || "No passenger UUID"}</div>
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="font-bold uppercase">{order.outcome}</div>
                                    <div className="mt-1 max-w-xs text-slate-500">{order.reason}</div>
                                  </td>
                                  <td className="px-3 py-2">{formatManila(order.order_placed_at)}</td>
                                  <td className="px-3 py-2">
                                    {formatManila(order.recorded_at)}
                                    {!order.recorded_at_exact ? <div className="text-[10px] text-amber-700">Recorded update time</div> : null}
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex min-w-40 flex-col gap-1.5">
                                      <button
                                        type="button"
                                        disabled={busyKey === "booking:" + order.booking_id}
                                        onClick={() => void exclusionAction("exclude_booking", { booking_id: order.booking_id }, "booking:" + order.booking_id)}
                                        className="rounded-lg border px-2 py-1 text-left font-semibold hover:bg-slate-50 disabled:opacity-50"
                                      >
                                        Exclude this booking
                                      </button>
                                      {order.passenger_id ? (
                                        <button
                                          type="button"
                                          disabled={busyKey === "passenger:" + order.passenger_id}
                                          onClick={() => void exclusionAction("mark_passenger", { passenger_id: order.passenger_id }, "passenger:" + order.passenger_id)}
                                          className="rounded-lg border border-violet-300 px-2 py-1 text-left font-semibold text-violet-800 hover:bg-violet-50 disabled:opacity-50"
                                        >
                                          Mark passenger as test
                                        </button>
                                      ) : null}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function Metric({ label, value, compact = false }: { label: string; value: number; compact?: boolean }) {
  return (
    <div className={["rounded-xl border bg-slate-50", compact ? "p-2.5" : "p-3"].join(" ")}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={compact ? "mt-1 text-xl font-black text-slate-950" : "mt-1 text-2xl font-black text-slate-950"}>{number(value)}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-white p-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-black text-slate-950">{value}</div>
    </div>
  );
}

function AverageRow({ label, data, prefix }: { label: string; data: Record<string, number>; prefix: string }) {
  return (
    <tr className="border-t">
      <td className="px-3 py-2 font-bold">{label}</td>
      <td className="px-3 py-2">{number(data[prefix + "_offered"]).toFixed(2)}</td>
      <td className="px-3 py-2">{number(data[prefix + "_completed"]).toFixed(2)}</td>
      <td className="px-3 py-2">{number(data[prefix + "_unaccepted"]).toFixed(2)}</td>
      <td className="px-3 py-2">{number(data[prefix + "_online_hours"]).toFixed(2)}</td>
    </tr>
  );
}
