"use client";

import React from "react";

type TodaBreakdownRow = {
  toda_name?: string | null;
  trips?: number | null;
  toda_share_total?: number | null;
};

type TripsTownRow = {
  town?: string | null;
  total_trips?: number | null;
  total_revenue?: number | null;
  company_share_total?: number | null;
  toda_share_total?: number | null;
  toda_completed_trips?: number | null;
  non_toda_completed_trips?: number | null;
  toda_breakdown?: TodaBreakdownRow[] | null;
};

type TripsResponse = {
  ok?: boolean;
  rows?: TripsTownRow[];
  totals?: {
    total_trips?: number | null;
    company_share_total?: number | null;
    toda_share_total?: number | null;
  };
  error?: string;
};

type DriverRow = {
  driver_id?: string | null;
  driver_name?: string | null;
  municipality?: string | null;
  toda_name?: string | null;
  completed_trips?: number | null;
  toda_completed_trips?: number | null;
  non_toda_completed_trips?: number | null;
  total_toda_share?: number | null;
  total_company_share?: number | null;
  total_platform_revenue?: number | null;
  average_rating?: number | null;
  ratings_count?: number | null;
};

type DriversResponse = {
  ok?: boolean;
  rows?: DriverRow[];
  error?: string;
};

type WatchlistRow = {
  driver_id?: string | null;
  driver_name?: string | null;
  municipality?: string | null;
  completed_trips?: number | null;
  ratings_count?: number | null;
  average_rating?: number | null;
  low_ratings_count?: number | null;
  latest_feedback?: string | null;
  latest_rating_at?: string | null;
};

type WatchlistResponse = {
  ok?: boolean;
  rows?: WatchlistRow[];
  error?: string;
};

type ScopeOption = "all" | "Lagawe" | "Hingyon" | "Banaue" | "Lamut" | "Kiangan" | "Unknown";

const CURRENCY = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

const NUMBER = new Intl.NumberFormat("en-PH");

function formatPeso(v: number) {
  return CURRENCY.format(Number.isFinite(v) ? v : 0);
}

function formatCount(v: number) {
  return NUMBER.format(Number.isFinite(v) ? v : 0);
}

function formatPHDateTime(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

function formatPHNow() {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());
}

function toCsvCell(v: unknown) {
  const s = String(v ?? "").replace(/"/g, '""');
  return `"${s}"`;
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<unknown>>) {
  const csv = [headers.map(toCsvCell).join(","), ...rows.map((r) => r.map(toCsvCell).join(","))].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function townMatch(scope: ScopeOption, town?: string | null) {
  if (scope === "all") return true;
  return String(town || "Unknown") === scope;
}

function Card({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{title}</div>
      <div className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{value}</div>
      {sub ? <div className="mt-2 text-sm text-slate-500">{sub}</div> : null}
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const [scope, setScope] = React.useState<ScopeOption>("all");
  const [lastRefresh, setLastRefresh] = React.useState<string>(formatPHNow());
  const [loading, setLoading] = React.useState<boolean>(true);
  const [msg, setMsg] = React.useState<string>("");

  const [tripRows, setTripRows] = React.useState<TripsTownRow[]>([]);
  const [driverRows, setDriverRows] = React.useState<DriverRow[]>([]);
  const [watchRows, setWatchRows] = React.useState<WatchlistRow[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const [tripRes, driverRes, watchRes] = await Promise.all([
        fetch("/api/admin/analytics/trips", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/analytics/drivers?limit=12", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/analytics/driver-watchlist?limit=8", { cache: "no-store", credentials: "same-origin" }),
      ]);

      const tripsJson = (await tripRes.json().catch(() => ({}))) as TripsResponse;
      const driversJson = (await driverRes.json().catch(() => ({}))) as DriversResponse;
      const watchJson = (await watchRes.json().catch(() => ({}))) as WatchlistResponse;

      if (!tripRes.ok) throw new Error(tripsJson.error || "Failed to load trips analytics.");
      if (!driverRes.ok) throw new Error(driversJson.error || "Failed to load driver analytics.");
      if (!watchRes.ok) throw new Error(watchJson.error || "Failed to load driver watchlist.");

      setTripRows(Array.isArray(tripsJson.rows) ? tripsJson.rows : []);
      setDriverRows(Array.isArray(driversJson.rows) ? driversJson.rows : []);
      setWatchRows(Array.isArray(watchJson.rows) ? watchJson.rows : []);
      setLastRefresh(formatPHNow());
    } catch (e: any) {
      setMsg(e?.message || "Failed to load analytics.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!alive) return;
      await load();
    };
    void run();
    return () => {
      alive = false;
    };
  }, [load]);

  const scopedTrips = React.useMemo(() => tripRows.filter((r) => townMatch(scope, r.town)), [tripRows, scope]);
  const scopedDrivers = React.useMemo(() => driverRows.filter((r) => townMatch(scope, r.municipality)), [driverRows, scope]);
  const scopedWatch = React.useMemo(() => watchRows.filter((r) => townMatch(scope, r.municipality)), [watchRows, scope]);

  const totals = React.useMemo(() => {
    const totalTrips = scopedTrips.reduce((sum, row) => sum + Number(row.total_trips || 0), 0);
    const companyShareTotal = scopedTrips.reduce((sum, row) => sum + Number((row.company_share_total ?? row.total_revenue) || 0), 0);
    const todaShareTotal = scopedTrips.reduce((sum, row) => sum + Number(row.toda_share_total || 0), 0);
    const todaTrips = scopedTrips.reduce((sum, row) => sum + Number(row.toda_completed_trips || 0), 0);
    const towns = new Set(scopedTrips.map((r) => String(r.town || "Unknown")));
    return {
      totalTrips,
      companyShareTotal,
      todaShareTotal,
      todaTrips,
      towns: towns.size,
      watchCount: scopedWatch.length,
    };
  }, [scopedTrips, scopedWatch]);

  const exportTrips = React.useCallback(() => {
    downloadCsv(
      `jride-analytics-trips-${scope}-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Town", "Completed Trips", "Company Share", "TODA Share", "TODA Trips"],
      scopedTrips.map((r) => [
        r.town || "Unknown",
        Number(r.total_trips || 0),
        Number((r.company_share_total ?? r.total_revenue) || 0),
        Number(r.toda_share_total || 0),
        Number(r.toda_completed_trips || 0),
      ])
    );
  }, [scopedTrips, scope]);

  const exportDrivers = React.useCallback(() => {
    downloadCsv(
      `jride-analytics-drivers-${scope}-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Driver", "Town", "TODA", "Completed Trips", "Company Share", "TODA Share", "Average Rating", "Ratings Count"],
      scopedDrivers.map((r) => [
        r.driver_name || "Unknown Driver",
        r.municipality || "Unknown",
        r.toda_name || "-",
        Number(r.completed_trips || 0),
        Number((r.total_company_share ?? r.total_platform_revenue) || 0),
        Number(r.total_toda_share || 0),
        Number(r.average_rating || 0).toFixed(2),
        Number(r.ratings_count || 0),
      ])
    );
  }, [scopedDrivers, scope]);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[28px] bg-slate-950 text-white shadow-xl">
          <div className="flex flex-col gap-6 p-6 md:p-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
                JRide Analytics Center
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">Operations analytics, company share, and TODA share</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 md:text-base">
                Built for expansion. View town-filtered results, export CSV reports, and monitor partner-safe metrics using Philippine date and time.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 text-sm text-slate-300 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Timezone</div>
                <div className="mt-1 font-semibold text-white">Asia/Manila (PHT)</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Last refresh</div>
                <div className="mt-1 font-semibold text-white">{lastRefresh}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Scope and exports</div>
              <div className="mt-1 text-sm text-slate-500">Use town filtering now so future partner access can stay town-scoped.</div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as ScopeOption)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 outline-none ring-0"
              >
                <option value="all">All towns</option>
                <option value="Lagawe">Lagawe</option>
                <option value="Hingyon">Hingyon</option>
                <option value="Banaue">Banaue</option>
                <option value="Lamut">Lamut</option>
                <option value="Kiangan">Kiangan</option>
                <option value="Unknown">Unknown</option>
              </select>
              <button onClick={() => void load()} className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
                Refresh
              </button>
              <button onClick={exportTrips} className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Export trips CSV
              </button>
              <button onClick={exportDrivers} className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Export drivers CSV
              </button>
            </div>
          </div>
          {msg ? <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{msg}</div> : null}
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Card title="Completed trips" value={formatCount(totals.totalTrips)} sub={scope === "all" ? "All filtered towns" : scope} />
          <Card title="Company share" value={formatPeso(totals.companyShareTotal)} sub="PHP 14 when TODA ride, PHP 15 otherwise" />
          <Card title="TODA share" value={formatPeso(totals.todaShareTotal)} sub="PHP 1 per TODA member ride" />
          <Card title="TODA rides" value={formatCount(totals.todaTrips)} sub="Completed trips with a TODA member driver" />
          <Card title="Driver watchlist" value={formatCount(totals.watchCount)} sub="Drivers needing review" />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="xl:col-span-5 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-900">Trips, company share, and TODA share by town</h2>
              <p className="mt-1 text-sm text-slate-500">Town totals from completed bookings. TODA share applies only when the driver has a TODA identity.</p>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="pb-3 pr-4 font-semibold">Town</th>
                    <th className="pb-3 pr-4 font-semibold">Trips</th>
                    <th className="pb-3 pr-4 font-semibold">Company</th>
                    <th className="pb-3 font-semibold">TODA</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedTrips.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-slate-400">{loading ? "Loading analytics..." : "No rows for the selected scope."}</td>
                    </tr>
                  ) : (
                    scopedTrips.map((row, idx) => (
                      <tr key={`${row.town || "Unknown"}-${idx}`} className="border-b border-slate-100 last:border-b-0">
                        <td className="py-3 pr-4 font-semibold text-slate-900">{row.town || "Unknown"}</td>
                        <td className="py-3 pr-4 text-slate-700">{formatCount(Number(row.total_trips || 0))}</td>
                        <td className="py-3 pr-4 text-slate-700">{formatPeso(Number((row.company_share_total ?? row.total_revenue) || 0))}</td>
                        <td className="py-3 text-slate-700">{formatPeso(Number(row.toda_share_total || 0))}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="xl:col-span-7 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-900">Top drivers with TODA identification</h2>
              <p className="mt-1 text-sm text-slate-500">Completed trips, company share, TODA share, and quality signals.</p>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="pb-3 pr-4 font-semibold">Driver</th>
                    <th className="pb-3 pr-4 font-semibold">Town</th>
                    <th className="pb-3 pr-4 font-semibold">TODA</th>
                    <th className="pb-3 pr-4 font-semibold">Trips</th>
                    <th className="pb-3 pr-4 font-semibold">Company</th>
                    <th className="pb-3 pr-4 font-semibold">TODA</th>
                    <th className="pb-3 pr-4 font-semibold">Avg rating</th>
                    <th className="pb-3 font-semibold">Ratings</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedDrivers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-slate-400">{loading ? "Loading drivers..." : "No driver analytics rows for the selected scope."}</td>
                    </tr>
                  ) : (
                    scopedDrivers.map((row, idx) => (
                      <tr key={`${row.driver_id || row.driver_name || "driver"}-${idx}`} className="border-b border-slate-100 last:border-b-0">
                        <td className="py-3 pr-4 font-semibold text-slate-900">{row.driver_name || "Unknown Driver"}</td>
                        <td className="py-3 pr-4 text-slate-700">{row.municipality || "Unknown"}</td>
                        <td className="py-3 pr-4 text-slate-700">{row.toda_name || "-"}</td>
                        <td className="py-3 pr-4 text-slate-700">{formatCount(Number(row.completed_trips || 0))}</td>
                        <td className="py-3 pr-4 text-slate-700">{formatPeso(Number((row.total_company_share ?? row.total_platform_revenue) || 0))}</td>
                        <td className="py-3 pr-4 text-slate-700">{formatPeso(Number(row.total_toda_share || 0))}</td>
                        <td className="py-3 pr-4 text-slate-700">{Number(row.average_rating || 0).toFixed(2)}</td>
                        <td className="py-3 text-slate-700">{formatCount(Number(row.ratings_count || 0))}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="xl:col-span-6 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-900">TODA breakdown by town</h2>
              <p className="mt-1 text-sm text-slate-500">Each TODA receives PHP 1 per completed ride when the driver is identified as a TODA member.</p>
            </div>
            <div className="mt-4 space-y-4">
              {scopedTrips.length === 0 ? (
                <div className="py-6 text-sm text-slate-400">{loading ? "Loading TODA rows..." : "No TODA rows for the selected scope."}</div>
              ) : (
                scopedTrips.map((row, idx) => {
                  const items = Array.isArray(row.toda_breakdown) ? row.toda_breakdown : [];
                  return (
                    <div key={`${row.town || "Unknown"}-${idx}`} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="font-semibold text-slate-900">{row.town || "Unknown"}</div>
                          <div className="mt-1 text-sm text-slate-500">
                            TODA rides: {formatCount(Number(row.toda_completed_trips || 0))} Â· TODA share: {formatPeso(Number(row.toda_share_total || 0))}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 text-left text-slate-500">
                              <th className="pb-2 pr-4 font-semibold">TODA</th>
                              <th className="pb-2 pr-4 font-semibold">Trips</th>
                              <th className="pb-2 font-semibold">Share</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.length === 0 ? (
                              <tr>
                                <td colSpan={3} className="py-3 text-slate-400">No TODA-tagged rides in this town.</td>
                              </tr>
                            ) : (
                              items.map((item, itemIdx) => (
                                <tr key={`${item.toda_name || "toda"}-${itemIdx}`} className="border-b border-slate-100 last:border-b-0">
                                  <td className="py-2 pr-4 text-slate-900">{item.toda_name || "Unknown TODA"}</td>
                                  <td className="py-2 pr-4 text-slate-700">{formatCount(Number(item.trips || 0))}</td>
                                  <td className="py-2 text-slate-700">{formatPeso(Number(item.toda_share_total || 0))}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="xl:col-span-6 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-900">Driver watchlist</h2>
              <p className="mt-1 text-sm text-slate-500">Low-rating watchlist for management review and partner-safe monitoring.</p>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="pb-3 pr-4 font-semibold">Driver</th>
                    <th className="pb-3 pr-4 font-semibold">Town</th>
                    <th className="pb-3 pr-4 font-semibold">Avg rating</th>
                    <th className="pb-3 pr-4 font-semibold">Low ratings</th>
                    <th className="pb-3 pr-4 font-semibold">Completed</th>
                    <th className="pb-3 pr-4 font-semibold">Latest feedback</th>
                    <th className="pb-3 font-semibold">Latest rating at (PHT)</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedWatch.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-slate-400">{loading ? "Loading watchlist..." : "No watchlist rows for the selected scope."}</td>
                    </tr>
                  ) : (
                    scopedWatch.map((row, idx) => (
                      <tr key={`${row.driver_id || row.driver_name || "watch"}-${idx}`} className="border-b border-slate-100 last:border-b-0">
                        <td className="py-3 pr-4 font-semibold text-slate-900">{row.driver_name || "Unknown Driver"}</td>
                        <td className="py-3 pr-4 text-slate-700">{row.municipality || "Unknown"}</td>
                        <td className="py-3 pr-4 text-slate-700">{Number(row.average_rating || 0).toFixed(2)}</td>
                        <td className="py-3 pr-4 text-slate-700">{formatCount(Number(row.low_ratings_count || 0))}</td>
                        <td className="py-3 pr-4 text-slate-700">{formatCount(Number(row.completed_trips || 0))}</td>
                        <td className="py-3 pr-4 text-slate-700">{row.latest_feedback || "-"}</td>
                        <td className="py-3 text-slate-700">{formatPHDateTime(row.latest_rating_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}


