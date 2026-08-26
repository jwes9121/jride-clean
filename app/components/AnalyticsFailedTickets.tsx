"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type RangeKey = "today" | "week" | "month" | "days";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function formatDateTime(value: unknown): string {
  const raw = clean(value);
  if (!raw) return "-";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return raw;
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatMoney(value: unknown): string {
  const amount = Number(value || 0);
  return (
    "PHP " +
    (Number.isFinite(amount) ? amount : 0).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function qualityClass(value: string): string {
  if (value === "exact") {
    return "border-emerald-300 bg-emerald-50 text-emerald-800";
  }
  if (value === "derived") {
    return "border-amber-300 bg-amber-50 text-amber-900";
  }
  return "border-slate-300 bg-slate-100 text-slate-700";
}

export default function AnalyticsFailedTickets() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<RangeKey>("month");
  const [days, setDays] = useState(30);
  const [service, setService] = useState("all");
  const [town, setTown] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState("");

  const endpoint = useMemo(() => {
    const params = new URLSearchParams();
    params.set("range", range);
    params.set("days", String(days));
    params.set("service", service);
    if (town) params.set("town", town);
    if (query) params.set("q", query);
    return "/api/admin/analytics/failed-tickets?" + params.toString();
  }, [days, query, range, service, town]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.ok !== true) {
        throw new Error(
          clean(json?.message || json?.error || "Failed-ticket analytics failed.")
        );
      }
      setData(json);
    } catch (loadError: any) {
      setError(
        clean(
          loadError?.message ||
            loadError ||
            "Failed-ticket analytics could not be loaded."
        )
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, open]);

  if (pathname !== "/admin/analytics-v3") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-[70] rounded-full border border-rose-300 bg-rose-700 px-5 py-3 text-sm font-black text-white shadow-2xl"
      >
        Failed / expired Ride & Takeout
      </button>

      {open ? (
        <div className="fixed inset-0 z-[125] bg-black/65 p-2 sm:p-5">
          <section className="mx-auto flex h-full max-w-[1500px] flex-col overflow-hidden rounded-2xl bg-slate-100 shadow-2xl">
            <header className="border-b bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-rose-700">
                    JRide Analytics
                  </div>
                  <h2 className="text-xl font-black text-slate-950">
                    Failed and expired Ride / Takeout tickets
                  </h2>
                  <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-600">
                    Ride and Takeout failures are shown together but remain
                    separately filterable. For old vendor timeouts with no
                    trustworthy exact event timestamp, JRide shows the expected
                    response deadline instead of a later database-update time.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void load()}
                    disabled={loading}
                    className="rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-50"
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
                <label className="text-[11px] font-bold text-slate-600">
                  Period
                  <select
                    value={range}
                    onChange={(event) =>
                      setRange(event.target.value as RangeKey)
                    }
                    className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-xs"
                  >
                    <option value="today">Today</option>
                    <option value="week">This week</option>
                    <option value="month">This month</option>
                    <option value="days">Last N days</option>
                  </select>
                </label>

                <label className="text-[11px] font-bold text-slate-600">
                  Days
                  <select
                    value={days}
                    disabled={range !== "days"}
                    onChange={(event) => setDays(Number(event.target.value))}
                    className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-xs disabled:opacity-50"
                  >
                    <option value={7}>7 days</option>
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                    <option value={365}>365 days</option>
                  </select>
                </label>

                <label className="text-[11px] font-bold text-slate-600">
                  Service
                  <select
                    value={service}
                    onChange={(event) => setService(event.target.value)}
                    className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-xs"
                  >
                    <option value="all">Ride + Takeout</option>
                    <option value="ride">Ride only</option>
                    <option value="takeout">Takeout only</option>
                  </select>
                </label>

                <label className="text-[11px] font-bold text-slate-600">
                  Town
                  <input
                    value={town}
                    onChange={(event) => setTown(event.target.value)}
                    placeholder="All towns"
                    className="mt-1 w-full rounded-lg border px-2 py-2 text-xs"
                  />
                </label>

                <label className="col-span-2 text-[11px] font-bold text-slate-600">
                  Search
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Ticket, passenger, driver, vendor, reason..."
                    className="mt-1 w-full rounded-lg border px-2 py-2 text-xs"
                  />
                </label>
              </div>
            </header>

            <div className="flex-1 overflow-auto p-3 sm:p-4">
              {error ? (
                <div className="mb-3 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
                  {error}
                </div>
              ) : null}

              {loading ? (
                <div className="rounded-xl border bg-white p-5 text-sm">
                  Loading failed tickets...
                </div>
              ) : null}

              {!loading && data ? (
                <>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-[10px] font-bold text-slate-500">
                        FAILED / EXPIRED
                      </div>
                      <div className="text-xl font-black">
                        {data.summary?.total || 0}
                      </div>
                    </div>
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-[10px] font-bold text-slate-500">
                        RIDE
                      </div>
                      <div className="text-xl font-black">
                        {data.summary?.ride || 0}
                      </div>
                    </div>
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-[10px] font-bold text-slate-500">
                        TAKEOUT
                      </div>
                      <div className="text-xl font-black">
                        {data.summary?.takeout || 0}
                      </div>
                    </div>
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-[10px] font-bold text-slate-500">
                        VENDOR TIMEOUTS
                      </div>
                      <div className="text-xl font-black">
                        {data.summary?.vendor_timeouts || 0}
                      </div>
                    </div>
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-[10px] font-bold text-slate-500">
                        NO REASON
                      </div>
                      <div className="text-xl font-black">
                        {data.summary?.no_reason || 0}
                      </div>
                    </div>
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-[10px] font-bold text-slate-500">
                        EXACT TIMES
                      </div>
                      <div className="text-xl font-black">
                        {data.summary?.exact_times || 0}
                      </div>
                    </div>
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-[10px] font-bold text-slate-500">
                        DERIVED DEADLINES
                      </div>
                      <div className="text-xl font-black">
                        {data.summary?.derived_deadlines || 0}
                      </div>
                    </div>
                  </div>

                  {(data.tickets || []).length === 0 ? (
                    <div className="mt-3 rounded-xl border bg-white p-5 text-sm text-slate-600">
                      No failed Ride or Takeout ticket matches the selected filters.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {(data.tickets || []).map((row: any) => (
                        <article
                          key={row.id}
                          className="rounded-xl border bg-white p-3 shadow-sm"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedId(
                                expandedId === row.id ? "" : row.id
                              )
                            }
                            className="flex w-full flex-wrap items-start justify-between gap-3 text-left"
                          >
                            <div>
                              <div className="font-mono text-sm font-black text-slate-950">
                                {row.booking_code}
                              </div>
                              <div className="mt-1 text-xs text-slate-600">
                                <span className="font-bold uppercase">
                                  {row.service_type}
                                </span>
                                {row.vehicle_type
                                  ? " / " + row.vehicle_type
                                  : ""}
                                {" | "}
                                {row.outcome}
                                {" | "}
                                {row.town || "Town not recorded"}
                              </div>
                            </div>
                            <div className="text-right text-xs">
                              <div className="font-bold text-slate-900">
                                {row.event_time_label}: {formatDateTime(row.event_at)}
                              </div>
                              <span
                                className={
                                  "mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase " +
                                  qualityClass(row.event_time_quality)
                                }
                              >
                                {row.event_time_quality}
                              </span>
                            </div>
                          </button>

                          <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-slate-600 md:grid-cols-4">
                            <div>
                              <span className="font-semibold text-slate-900">
                                Passenger:
                              </span>{" "}
                              {row.passenger_name}
                            </div>
                            <div>
                              <span className="font-semibold text-slate-900">
                                Driver:
                              </span>{" "}
                              {row.driver_name ||
                                (row.assigned_driver
                                  ? "Driver profile unavailable"
                                  : "Not assigned")}
                            </div>
                            <div>
                              <span className="font-semibold text-slate-900">
                                Vendor:
                              </span>{" "}
                              {row.vendor_name || "Not applicable"}
                            </div>
                            <div>
                              <span className="font-semibold text-slate-900">
                                Amount:
                              </span>{" "}
                              {formatMoney(row.amount)}
                            </div>
                          </div>

                          <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-700">
                            <span className="font-semibold text-slate-900">
                              Reason:
                            </span>{" "}
                            {row.reason}
                          </div>

                          {expandedId === row.id ? (
                            <div className="mt-3 grid grid-cols-1 gap-2 border-t pt-3 text-xs md:grid-cols-2">
                              <div className="rounded-lg bg-slate-50 p-2">
                                <div>
                                  <span className="font-semibold">Placed:</span>{" "}
                                  {formatDateTime(row.placed_at)}
                                </div>
                                <div className="mt-1">
                                  <span className="font-semibold">
                                    {row.event_time_label}:
                                  </span>{" "}
                                  {formatDateTime(row.event_at)}
                                </div>
                                <div className="mt-1 text-[11px] text-slate-500">
                                  {row.event_time_note}
                                </div>
                              </div>

                              <div className="rounded-lg bg-slate-50 p-2">
                                <div>
                                  <span className="font-semibold">Lifecycle:</span>{" "}
                                  booking={row.status || "-"}, vendor=
                                  {row.vendor_status || "-"}, driver=
                                  {row.driver_status || "-"}, customer=
                                  {row.customer_status || "-"}
                                </div>
                                <div className="mt-1">
                                  <span className="font-semibold">Route:</span>{" "}
                                  {row.pickup || "-"}
                                  {" -> "}
                                  {row.dropoff || "-"}
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
