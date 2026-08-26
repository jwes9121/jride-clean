"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Tab = "tickets" | "attendance";

type RangeKey = "today" | "week" | "month" | "days";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function money(value: unknown): string {
  const n = Number(value || 0);
  return "PHP " + (Number.isFinite(n) ? n : 0).toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

function fmtDateTime(value: unknown): string {
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

function hours(value: unknown): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0 h";
  const whole = Math.floor(n);
  const minutes = Math.round((n - whole) * 60);
  if (!whole) return minutes + " min";
  return whole + " h " + minutes + " min";
}

export default function AnalyticsCompletedTicketsVendorAttendance() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("tickets");
  const [range, setRange] = useState<RangeKey>("month");
  const [days, setDays] = useState(30);
  const [service, setService] = useState("all");
  const [group, setGroup] = useState("pilot_active");
  const [town, setTown] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedVendor, setExpandedVendor] = useState("");

  const endpoint = useMemo(() => {
    const params = new URLSearchParams();
    params.set("range", range);
    params.set("days", String(days));
    if (town) params.set("town", town);
    if (query) params.set("q", query);

    if (tab === "tickets") {
      params.set("service", service);
      return "/api/admin/analytics/successful-tickets?" + params.toString();
    }

    params.set("group", group);
    return "/api/admin/analytics/vendor-attendance?" + params.toString();
  }, [days, group, query, range, service, tab, town]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok !== true) {
        throw new Error(clean(json?.message || json?.error || "Analytics request failed."));
      }
      setData(json);
    } catch (err: any) {
      setError(clean(err?.message || err || "Analytics request failed."));
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
        className="fixed bottom-4 right-4 z-[70] rounded-full bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-2xl"
      >
        Completed tickets & Vendor attendance
      </button>

      {open ? (
        <div className="fixed inset-0 z-[120] bg-black/65 p-2 sm:p-5">
          <section className="mx-auto flex h-full max-w-[1500px] flex-col overflow-hidden rounded-2xl bg-slate-100 shadow-2xl">
            <header className="border-b bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">JRide Analytics</div>
                  <h2 className="text-xl font-black text-slate-950">Completed ticket list and vendor attendance</h2>
                  <p className="mt-1 text-xs text-slate-600">Successful Ride and Takeout bookings are separated from vendor online attendance.</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="rounded-xl border px-4 py-2 text-sm font-bold">Close</button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setTab("tickets")} className={"rounded-full px-4 py-2 text-xs font-bold " + (tab === "tickets" ? "bg-slate-950 text-white" : "border bg-white")}>Successful tickets</button>
                <button type="button" onClick={() => setTab("attendance")} className={"rounded-full px-4 py-2 text-xs font-bold " + (tab === "attendance" ? "bg-slate-950 text-white" : "border bg-white")}>Vendor attendance</button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
                <label className="text-[11px] font-bold text-slate-600">Period
                  <select value={range} onChange={(e) => setRange(e.target.value as RangeKey)} className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-xs">
                    <option value="today">Today</option>
                    <option value="week">This week</option>
                    <option value="month">This month</option>
                    <option value="days">Last N days</option>
                  </select>
                </label>
                <label className="text-[11px] font-bold text-slate-600">Days
                  <select value={days} disabled={range !== "days"} onChange={(e) => setDays(Number(e.target.value))} className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-xs disabled:opacity-50">
                    <option value={7}>7 days</option>
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                    <option value={365}>365 days</option>
                  </select>
                </label>
                {tab === "tickets" ? (
                  <label className="text-[11px] font-bold text-slate-600">Service
                    <select value={service} onChange={(e) => setService(e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-xs">
                      <option value="all">Ride + Takeout</option>
                      <option value="ride">Ride</option>
                      <option value="takeout">Takeout</option>
                    </select>
                  </label>
                ) : (
                  <label className="text-[11px] font-bold text-slate-600">Vendor group
                    <select value={group} onChange={(e) => setGroup(e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-xs">
                      <option value="pilot_active">Pilot / Active</option>
                      <option value="batch2">Batch 2</option>
                      <option value="removed">Removed</option>
                      <option value="all">All groups</option>
                    </select>
                  </label>
                )}
                <label className="text-[11px] font-bold text-slate-600">Town
                  <input value={town} onChange={(e) => setTown(e.target.value)} placeholder="All towns" className="mt-1 w-full rounded-lg border px-2 py-2 text-xs" />
                </label>
                <label className="col-span-2 text-[11px] font-bold text-slate-600">Search
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Booking, passenger, driver, vendor..." className="mt-1 w-full rounded-lg border px-2 py-2 text-xs" />
                </label>
              </div>
            </header>

            <div className="flex-1 overflow-auto p-3 sm:p-4">
              {error ? <div className="mb-3 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</div> : null}
              {loading ? <div className="rounded-xl border bg-white p-5 text-sm">Loading...</div> : null}

              {!loading && data && tab === "tickets" ? (
                <>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                    <div className="rounded-xl border bg-white p-3"><div className="text-[10px] font-bold text-slate-500">COMPLETED</div><div className="text-xl font-black">{data.summary?.total || 0}</div></div>
                    <div className="rounded-xl border bg-white p-3"><div className="text-[10px] font-bold text-slate-500">RIDE</div><div className="text-xl font-black">{data.summary?.ride || 0}</div></div>
                    <div className="rounded-xl border bg-white p-3"><div className="text-[10px] font-bold text-slate-500">TAKEOUT</div><div className="text-xl font-black">{data.summary?.takeout || 0}</div></div>
                    <div className="rounded-xl border bg-white p-3"><div className="text-[10px] font-bold text-slate-500">GROSS</div><div className="text-sm font-black">{money(data.summary?.gross)}</div></div>
                    <div className="rounded-xl border bg-white p-3"><div className="text-[10px] font-bold text-slate-500">COMPANY CUT</div><div className="text-sm font-black">{money(data.summary?.company_cut)}</div></div>
                    <div className="rounded-xl border bg-white p-3"><div className="text-[10px] font-bold text-slate-500">DRIVER PAYOUT</div><div className="text-sm font-black">{money(data.summary?.driver_payout)}</div></div>
                  </div>

                  <div className="mt-3 overflow-x-auto rounded-xl border bg-white">
                    <table className="min-w-full text-left text-xs">
                      <thead className="border-b bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-2">Completed</th><th className="p-2">Ticket</th><th className="p-2">Service</th><th className="p-2">Town</th><th className="p-2">Passenger</th><th className="p-2">Driver</th><th className="p-2">Vendor</th><th className="p-2">Fare</th><th className="p-2">Route</th></tr></thead>
                      <tbody>
                        {(data.tickets || []).map((row: any) => (
                          <tr key={row.id} className="border-b last:border-0">
                            <td className="whitespace-nowrap p-2">{fmtDateTime(row.completed_at)}</td>
                            <td className="p-2 font-mono font-bold">{row.booking_code}</td>
                            <td className="p-2 font-bold uppercase">{row.service_type}</td>
                            <td className="p-2">{row.town || "-"}</td>
                            <td className="p-2">{row.passenger_name}</td>
                            <td className="p-2">{row.driver_name || "-"}</td>
                            <td className="p-2">{row.vendor_name || "-"}</td>
                            <td className="whitespace-nowrap p-2 font-bold">{money(row.fare)}</td>
                            <td className="max-w-sm p-2 text-[11px] text-slate-600">{row.pickup || "-"}{" -> "}{row.dropoff || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

              {!loading && data && tab === "attendance" ? (
                <>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div className="rounded-xl border bg-white p-3"><div className="text-[10px] font-bold text-slate-500">VENDORS</div><div className="text-xl font-black">{data.summary?.vendors || 0}</div></div>
                    <div className="rounded-xl border bg-white p-3"><div className="text-[10px] font-bold text-slate-500">OPENED TODAY</div><div className="text-xl font-black">{data.summary?.opened_today || 0}</div></div>
                    <div className="rounded-xl border bg-white p-3"><div className="text-[10px] font-bold text-slate-500">ATTENDANCE DAYS</div><div className="text-xl font-black">{data.summary?.attendance_days || 0}</div></div>
                    <div className="rounded-xl border bg-white p-3"><div className="text-[10px] font-bold text-slate-500">TRACKED ONLINE</div><div className="text-xl font-black">{hours(data.summary?.online_hours)}</div></div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {(data.vendors || []).map((vendor: any) => (
                      <div key={vendor.vendor_id} className="rounded-xl border bg-white p-3">
                        <button type="button" onClick={() => setExpandedVendor(expandedVendor === vendor.vendor_id ? "" : vendor.vendor_id)} className="flex w-full flex-wrap items-start justify-between gap-2 text-left">
                          <div><div className="font-black">{vendor.display_name}</div><div className="text-[11px] text-slate-500">{vendor.town || "-"} | {vendor.onboarding_status || "-"}</div></div>
                          <div className="grid grid-cols-3 gap-3 text-right text-[11px]">
                            <div><div className="text-slate-400">TODAY</div><div className="font-bold">{hours(vendor.today?.online_hours)}</div></div>
                            <div><div className="text-slate-400">WEEK</div><div className="font-bold">{hours(vendor.this_week?.online_hours)}</div></div>
                            <div><div className="text-slate-400">MONTH</div><div className="font-bold">{hours(vendor.this_month?.online_hours)}</div></div>
                          </div>
                        </button>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                          <div className="rounded-lg bg-slate-50 p-2">Today: <b>{vendor.today?.attendance_days || 0}</b> attendance day</div>
                          <div className="rounded-lg bg-slate-50 p-2">This week: <b>{vendor.this_week?.attendance_days || 0}</b> days</div>
                          <div className="rounded-lg bg-slate-50 p-2">This month: <b>{vendor.this_month?.attendance_days || 0}</b> days</div>
                        </div>
                        {expandedVendor === vendor.vendor_id ? (
                          <div className="mt-3 overflow-x-auto rounded-lg border">
                            <table className="min-w-full text-left text-xs">
                              <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                                <tr><th className="p-2">Date</th><th className="p-2">Opened</th><th className="p-2">First seen</th><th className="p-2">Last seen</th><th className="p-2">Online</th></tr>
                              </thead>
                              <tbody>
                                {(vendor.daily || []).map((row: any) => (
                                  <tr key={row.date} className="border-t">
                                    <td className="p-2 font-bold">{row.date}</td>
                                    <td className="p-2">{fmtDateTime(row.opened_at)}</td>
                                    <td className="p-2">{fmtDateTime(row.first_seen_at)}</td>
                                    <td className="p-2">{fmtDateTime(row.last_seen_at)}</td>
                                    <td className="p-2 font-bold">{hours(row.online_hours)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
