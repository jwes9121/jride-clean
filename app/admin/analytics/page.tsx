"use client";

import React from "react";

type TripsTownRow = {
  town?: string | null;
  total_trips?: number | null;
  total_revenue?: number | null;
  company_share_total?: number | null;
  toda_share_total?: number | null;
  toda_completed_trips?: number | null;
  toda_breakdown?: Array<{ toda_name?: string | null; trips?: number | null; toda_share_total?: number | null }>;
};

type TripsResponse = {
  ok?: boolean;
  rows?: TripsTownRow[];
  totals?: {
    total_trips?: number | null;
    company_share_total?: number | null;
    toda_share_total?: number | null;
    toda_completed_trips?: number | null;
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
  gross_proposed_fare_earnings?: number | null;
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

type FailureRow = {
  id?: string | null;
  created_at?: string | null;
  passenger_id?: string | null;
  passenger_name?: string | null;
  town?: string | null;
  from_label?: string | null;
  to_label?: string | null;
  requested_vehicle_type?: string | null;
  alternate_vehicle_type?: string | null;
  code?: string | null;
  message?: string | null;
  local_requested_count?: number | null;
  local_alternate_count?: number | null;
  emergency_requested_count?: number | null;
  emergency_alternate_count?: number | null;
};

type FailuresResponse = {
  ok?: boolean;
  rows?: FailureRow[];
  totals?: { total_failures?: number | null; by_town?: Record<string, number> };
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
  const [failureRows, setFailureRows] = React.useState<FailureRow[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const [tripRes, driverRes, watchRes, failRes] = await Promise.all([
        fetch("/api/admin/analytics/trips", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/analytics/drivers?limit=20", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/analytics/driver-watchlist?limit=8", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/analytics/no-driver-searches?limit=100", { cache: "no-store", credentials: "same-origin" }),
      ]);

      const tripsJson = (await tripRes.json().catch(() => ({}))) as TripsResponse;
      const driversJson = (await driverRes.json().catch(() => ({}))) as DriversResponse;
      const watchJson = (await watchRes.json().catch(() => ({}))) as WatchlistResponse;
      const failJson = (await failRes.json().catch(() => ({}))) as FailuresResponse;

      if (!tripRes.ok) throw new Error(tripsJson.error || "Failed to load trips analytics.");
      if (!driverRes.ok) throw new Error(driversJson.error || "Failed to load driver analytics.");
      if (!watchRes.ok) throw new Error(watchJson.error || "Failed to load driver watchlist.");
      if (!failRes.ok) throw new Error(failJson.error || "Failed to load no-driver analytics.");

      setTripRows(Array.isArray(tripsJson.rows) ? tripsJson.rows : []);
      setDriverRows(Array.isArray(driversJson.rows) ? driversJson.rows : []);
      setWatchRows(Array.isArray(watchJson.rows) ? watchJson.rows : []);
      setFailureRows(Array.isArray(failJson.rows) ? failJson.rows : []);
      setLastRefresh(formatPHNow());
    } catch (e: any) {
      setMsg(e?.message || "Failed to load analytics.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let alive = true;
    const run = async () => { if (alive) await load(); };
    void run();
    return () => { alive = false; };
  }, [load]);

  const scopedTrips = React.useMemo(() => tripRows.filter((r) => townMatch(scope, r.town)), [tripRows, scope]);
  const scopedDrivers = React.useMemo(() => driverRows.filter((r) => townMatch(scope, r.municipality)), [driverRows, scope]);
  const scopedWatch = React.useMemo(() => watchRows.filter((r) => townMatch(scope, r.municipality)), [watchRows, scope]);
  const scopedFailures = React.useMemo(() => failureRows.filter((r) => townMatch(scope, r.town)), [failureRows, scope]);

  const totals = React.useMemo(() => {
    const totalTrips = scopedTrips.reduce((sum, row) => sum + Number(row.total_trips || 0), 0);
    const companyShareTotal = scopedTrips.reduce((sum, row) => sum + Number((row.company_share_total ?? row.total_revenue) || 0), 0);
    const todaShareTotal = scopedTrips.reduce((sum, row) => sum + Number(row.toda_share_total || 0), 0);
    const todaTrips = scopedTrips.reduce((sum, row) => sum + Number(row.toda_completed_trips || 0), 0);
    const grossProposedFareEarnings = scopedDrivers.reduce((sum, row) => sum + Number(row.gross_proposed_fare_earnings || 0), 0);
    const towns = new Set(scopedTrips.map((r) => String(r.town || "Unknown")));
    return { totalTrips, companyShareTotal, todaShareTotal, todaTrips, grossProposedFareEarnings, towns: towns.size, watchCount: scopedWatch.length, noDriverCount: scopedFailures.length };
  }, [scopedTrips, scopedDrivers, scopedWatch, scopedFailures]);

  const exportTrips = React.useCallback(() => {
    downloadCsv(`jride-analytics-trips-${scope}-${new Date().toISOString().slice(0, 10)}.csv`, ["Town", "Completed Trips", "Company Share", "TODA Share", "TODA Trips"], scopedTrips.map((r) => [r.town || "Unknown", Number(r.total_trips || 0), Number((r.company_share_total ?? r.total_revenue) || 0), Number(r.toda_share_total || 0), Number(r.toda_completed_trips || 0)]));
  }, [scopedTrips, scope]);

  const exportDrivers = React.useCallback(() => {
    downloadCsv(`jride-analytics-drivers-${scope}-${new Date().toISOString().slice(0, 10)}.csv`, ["Driver", "Town", "TODA", "Completed Trips", "Gross Proposed Fare", "Company Share", "TODA Share", "Average Rating", "Ratings Count"], scopedDrivers.map((r) => [r.driver_name || "Unknown Driver", r.municipality || "Unknown", r.toda_name || "-", Number(r.completed_trips || 0), Number(r.gross_proposed_fare_earnings || 0), Number((r.total_company_share ?? r.total_platform_revenue) || 0), Number(r.total_toda_share || 0), Number(r.average_rating || 0).toFixed(2), Number(r.ratings_count || 0)]));
  }, [scopedDrivers, scope]);

  const exportFailures = React.useCallback(() => {
    downloadCsv(`jride-no-driver-searches-${scope}-${new Date().toISOString().slice(0, 10)}.csv`, ["Passenger", "Town", "Time (PHT)", "Pickup", "Dropoff", "Requested Vehicle", "Alternate Vehicle", "Code", "Message"], scopedFailures.map((r) => [r.passenger_name || "Unknown Passenger", r.town || "Unknown", formatPHDateTime(r.created_at), r.from_label || "-", r.to_label || "-", r.requested_vehicle_type || "-", r.alternate_vehicle_type || "-", r.code || "-", r.message || "-"]));
  }, [scopedFailures, scope]);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[28px] bg-slate-950 text-white shadow-xl">
          <div className="flex flex-col gap-6 p-6 md:p-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">JRide Analytics Center</div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">Operations analytics, company share, TODA share, and no-driver demand</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 md:text-base">Built for expansion. View town-filtered results, export CSV reports, and monitor partner-safe metrics using Philippine date and time.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 text-sm text-slate-300 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"><div className="text-xs uppercase tracking-[0.14em] text-slate-400">Timezone</div><div className="mt-1 font-semibold text-white">Asia/Manila (PHT)</div></div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"><div className="text-xs uppercase tracking-[0.14em] text-slate-400">Last refresh</div><div className="mt-1 font-semibold text-white">{lastRefresh}</div></div>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Scope and exports</div>
              <p className="mt-1 text-sm text-slate-500">Use town filtering now so future partner access can stay town-scoped.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700" value={scope} onChange={(e) => setScope(e.target.value as ScopeOption)}>
                <option value="all">All towns</option>
                <option value="Lagawe">Lagawe</option>
                <option value="Hingyon">Hingyon</option>
                <option value="Banaue">Banaue</option>
                <option value="Lamut">Lamut</option>
                <option value="Kiangan">Kiangan</option>
                <option value="Unknown">Unknown</option>
              </select>
              <button className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800" onClick={() => void load()} disabled={loading}>Refresh</button>
              <button className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={exportTrips}>Export trips CSV</button>
              <button className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={exportDrivers}>Export drivers CSV</button>
              <button className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={exportFailures}>Export no-driver CSV</button>
            </div>
          </div>
          {msg ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{msg}</div> : null}
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
          <Card title="Completed trips" value={formatCount(totals.totalTrips)} sub="All filtered towns" />
          <Card title="Company share" value={formatPeso(totals.companyShareTotal)} sub="PHP 14 when TODA ride, PHP 15 otherwise" />
          <Card title="TODA share" value={formatPeso(totals.todaShareTotal)} sub="PHP 1 per TODA member ride" />
          <Card title="TODA rides" value={formatCount(totals.todaTrips)} sub="Completed trips with a TODA member driver" />
          <Card title="Driver gross fares" value={formatPeso(totals.grossProposedFareEarnings)} sub="Sum of completed-trip proposed fares" />
          <Card title="No-driver searches" value={formatCount(totals.noDriverCount)} sub="Passengers who searched but got no driver" />
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold tracking-tight text-slate-900">Trips, company share, and TODA share by town</h2>
            <p className="mt-1 text-sm text-slate-500">Town totals from completed bookings. TODA share applies only when the driver has a TODA identity.</p>
            <div className="mt-4 overflow-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-slate-500"><th className="py-3 pr-4 font-semibold">Town</th><th className="py-3 pr-4 font-semibold">Trips</th><th className="py-3 pr-4 font-semibold">Company</th><th className="py-3 pr-4 font-semibold">TODA</th></tr></thead>
                <tbody>
                  {scopedTrips.length === 0 ? <tr><td colSpan={4} className="py-6 text-slate-400">No rows for the selected scope.</td></tr> : scopedTrips.map((row) => (
                    <tr key={String(row.town || "Unknown")} className="border-b border-slate-100 last:border-0">
                      <td className="py-3 pr-4 font-medium text-slate-900">{row.town || "Unknown"}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatCount(Number(row.total_trips || 0))}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatPeso(Number((row.company_share_total ?? row.total_revenue) || 0))}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatPeso(Number(row.toda_share_total || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold tracking-tight text-slate-900">Top drivers with TODA identification</h2>
            <p className="mt-1 text-sm text-slate-500">Completed trips, gross proposed fares, company share, TODA share, and quality signals.</p>
            <div className="mt-4 overflow-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-slate-500"><th className="py-3 pr-4 font-semibold">Driver</th><th className="py-3 pr-4 font-semibold">Town</th><th className="py-3 pr-4 font-semibold">TODA</th><th className="py-3 pr-4 font-semibold">Trips</th><th className="py-3 pr-4 font-semibold">Gross fares</th><th className="py-3 pr-4 font-semibold">Company</th><th className="py-3 pr-4 font-semibold">TODA</th><th className="py-3 pr-4 font-semibold">Avg rating</th><th className="py-3 font-semibold">Ratings</th></tr></thead>
                <tbody>
                  {scopedDrivers.length === 0 ? <tr><td colSpan={9} className="py-6 text-slate-400">No driver analytics rows for the selected scope.</td></tr> : scopedDrivers.map((row) => (
                    <tr key={String(row.driver_id || row.driver_name || Math.random())} className="border-b border-slate-100 last:border-0">
                      <td className="py-3 pr-4 font-medium text-slate-900">{row.driver_name || "Unknown Driver"}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.municipality || "Unknown"}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.toda_name || "-"}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatCount(Number(row.completed_trips || 0))}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatPeso(Number(row.gross_proposed_fare_earnings || 0))}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatPeso(Number((row.total_company_share ?? row.total_platform_revenue) || 0))}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatPeso(Number(row.total_toda_share || 0))}</td>
                      <td className="py-3 pr-4 text-slate-700">{Number(row.average_rating || 0).toFixed(2)}</td>
                      <td className="py-3 text-slate-700">{formatCount(Number(row.ratings_count || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold tracking-tight text-slate-900">TODA breakdown by town</h2>
            <p className="mt-1 text-sm text-slate-500">Each TODA receives PHP 1 per completed ride when the driver is identified as a TODA member.</p>
            <div className="mt-4 space-y-4">
              {scopedTrips.map((row) => (
                <div key={`toda-${row.town || "Unknown"}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="font-semibold text-slate-900">{row.town || "Unknown"}</div>
                  <div className="mt-1 text-sm text-slate-500">TODA rides: {formatCount(Number(row.toda_completed_trips || 0))} - TODA share: {formatPeso(Number(row.toda_share_total || 0))}</div>
                  <div className="mt-3 overflow-auto">
                    <table className="min-w-full text-sm"><thead><tr className="border-b border-slate-200 text-left text-slate-500"><th className="py-2 pr-4 font-semibold">TODA</th><th className="py-2 pr-4 font-semibold">Trips</th><th className="py-2 font-semibold">Share</th></tr></thead><tbody>
                      {Array.isArray(row.toda_breakdown) && row.toda_breakdown.length > 0 ? row.toda_breakdown.map((item, idx) => (
                        <tr key={`${row.town || "Unknown"}-${item.toda_name || idx}`} className="border-b border-slate-100 last:border-0"><td className="py-2 pr-4 text-slate-700">{item.toda_name || "-"}</td><td className="py-2 pr-4 text-slate-700">{formatCount(Number(item.trips || 0))}</td><td className="py-2 text-slate-700">{formatPeso(Number(item.toda_share_total || 0))}</td></tr>
                      )) : <tr><td colSpan={3} className="py-3 text-slate-400">No TODA-tagged rides in this town.</td></tr>}
                    </tbody></table>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold tracking-tight text-slate-900">No-driver search demand</h2>
            <p className="mt-1 text-sm text-slate-500">Passengers who searched but were not able to get a driver. This reads from driver_search_failures and will populate only after booking routes start writing to that table.</p>
            <div className="mt-4 overflow-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-slate-500"><th className="py-3 pr-4 font-semibold">Passenger</th><th className="py-3 pr-4 font-semibold">Town</th><th className="py-3 pr-4 font-semibold">Time (PHT)</th><th className="py-3 pr-4 font-semibold">Pickup</th><th className="py-3 pr-4 font-semibold">Dropoff</th><th className="py-3 pr-4 font-semibold">Requested</th><th className="py-3 font-semibold">Alternate</th></tr></thead>
                <tbody>
                  {scopedFailures.length === 0 ? <tr><td colSpan={7} className="py-6 text-slate-400">No no-driver search rows yet. The table exists, but booking routes must still write into it.</td></tr> : scopedFailures.map((row) => (
                    <tr key={String(row.id || Math.random())} className="border-b border-slate-100 last:border-0">
                      <td className="py-3 pr-4 font-medium text-slate-900">{row.passenger_name || "Unknown Passenger"}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.town || "Unknown"}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatPHDateTime(row.created_at)}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.from_label || "-"}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.to_label || "-"}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.requested_vehicle_type || "-"}</td>
                      <td className="py-3 text-slate-700">{row.alternate_vehicle_type || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-1">
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold tracking-tight text-slate-900">Driver watchlist</h2>
            <p className="mt-1 text-sm text-slate-500">Low-rating watchlist for management review and partner-safe monitoring.</p>
            <div className="mt-4 overflow-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-slate-500"><th className="py-3 pr-4 font-semibold">Driver</th><th className="py-3 pr-4 font-semibold">Town</th><th className="py-3 pr-4 font-semibold">Avg rating</th><th className="py-3 pr-4 font-semibold">Low ratings</th><th className="py-3 pr-4 font-semibold">Completed</th><th className="py-3 pr-4 font-semibold">Latest feedback</th><th className="py-3 font-semibold">Latest rating at (PHT)</th></tr></thead>
                <tbody>
                  {scopedWatch.length === 0 ? <tr><td colSpan={7} className="py-6 text-slate-400">No watchlist rows for the selected scope.</td></tr> : scopedWatch.map((row) => (
                    <tr key={String(row.driver_id || row.driver_name || Math.random())} className="border-b border-slate-100 last:border-0">
                      <td className="py-3 pr-4 font-medium text-slate-900">{row.driver_name || "Unknown Driver"}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.municipality || "Unknown"}</td>
                      <td className="py-3 pr-4 text-slate-700">{Number(row.average_rating || 0).toFixed(2)}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatCount(Number(row.low_ratings_count || 0))}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatCount(Number(row.completed_trips || 0))}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.latest_feedback || "-"}</td>
                      <td className="py-3 text-slate-700">{formatPHDateTime(row.latest_rating_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
