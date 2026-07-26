"use client";

import * as React from "react";

type DashboardRow = {
  id: string; driver_id: string; driver_name: string; callsign: string | null;
  municipality: string | null; vehicle_type: string | null; phone: string | null;
  online_status: string | null; location_updated_at: string | null; status: string;
  created_at: string; expires_at: string; first_seen_at: string | null;
  last_fetched_at: string | null; fetch_count: number; responded_at: string | null;
  expired_at: string | null; response_result: string | null; response_device_id: string | null;
  notes: string | null; response_seconds: number | null; fetch_delay_seconds: number | null;
  was_fetched: boolean;
};

type Summary = {
  total: number; pending: number; acknowledged: number; expired: number;
  cancelled: number; fetched: number; never_fetched: number;
  acknowledgement_rate_percent: number; average_response_seconds: number | null;
};

const EMPTY_SUMMARY: Summary = { total: 0, pending: 0, acknowledged: 0, expired: 0, cancelled: 0, fetched: 0, never_fetched: 0, acknowledgement_rate_percent: 0, average_response_seconds: null };

function manilaTime(value: string | null | undefined) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "2-digit", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(value));
  } catch { return String(value); }
}

function duration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "-";
  if (seconds < 60) return seconds + " sec";
  const minutes = Math.floor(seconds / 60);
  return minutes + "m " + (seconds % 60) + "s";
}

function statusClass(status: string) {
  switch (String(status || "").toLowerCase()) {
    case "acknowledged": return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "expired": return "border-rose-200 bg-rose-50 text-rose-800";
    case "pending": return "border-amber-200 bg-amber-50 text-amber-800";
    case "cancelled": return "border-slate-200 bg-slate-50 text-slate-700";
    default: return "border-slate-200 bg-white text-slate-700";
  }
}

function Card({ label, value, detail }: { label: string; value: React.ReactNode; detail?: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className="mt-2 text-3xl font-bold text-slate-900">{value}</div>
    {detail ? <div className="mt-1 text-xs text-slate-500">{detail}</div> : null}
  </div>;
}

export default function DriverAvailabilityPingsPage() {
  const [rows, setRows] = React.useState<DashboardRow[]>([]);
  const [summary, setSummary] = React.useState<Summary>(EMPTY_SUMMARY);
  const [towns, setTowns] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [message, setMessage] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [town, setTown] = React.useState("");
  const [fromDate, setFromDate] = React.useState("");
  const [toDate, setToDate] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true); setMessage("");
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    if (town) params.set("town", town);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    params.set("limit", "500");

    try {
      const response = await fetch("/api/admin/driver-availability-pings?" + params.toString(), { cache: "no-store", credentials: "include" });
      const result: any = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Failed to load Duty Check data (HTTP " + response.status + ")");
      setRows(Array.isArray(result.rows) ? result.rows : []);
      setSummary(result.summary || EMPTY_SUMMARY);
      setTowns(Array.isArray(result.towns) ? result.towns : []);
    } catch (error: any) {
      setRows([]); setSummary(EMPTY_SUMMARY); setMessage(error?.message || "Failed to load Duty Check data.");
    } finally { setLoading(false); }
  }, [search, status, town, fromDate, toDate]);

  React.useEffect(() => { load(); }, [load]);

  return <main className="min-h-screen bg-slate-50 p-4 md:p-6">
    <div className="mx-auto max-w-7xl">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-amber-700">Observation mode</div>
            <h1 className="mt-1 text-2xl font-bold text-slate-950 md:text-3xl">Driver Duty Check</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">Read-only monitoring of Duty Check delivery, fetch, acknowledgement, and expiry. No automatic incentive penalty is applied.</p>
          </div>
          <button type="button" onClick={load} disabled={loading} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{loading ? "Refreshing..." : "Refresh"}</button>
        </div>
      </div>

      {message ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{message}</div> : null}

      <section className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Checks sent" value={summary.total} />
        <Card label="Acknowledged" value={summary.acknowledged} detail={summary.acknowledgement_rate_percent + "% response rate"} />
        <Card label="Expired" value={summary.expired} />
        <Card label="Average response" value={duration(summary.average_response_seconds)} detail="Measured from first device fetch" />
        <Card label="Pending" value={summary.pending} />
        <Card label="Fetched" value={summary.fetched} />
        <Card label="Never fetched" value={summary.never_fetched} />
        <Card label="Cancelled" value={summary.cancelled} />
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-6">
          <label className="lg:col-span-2"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Search</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Driver, UUID, phone, notes" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" /></label>
          <label><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</span><select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="">All</option><option value="pending">Pending</option><option value="acknowledged">Acknowledged</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></select></label>
          <label><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Town</span><select value={town} onChange={(e) => setTown(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="">All towns</option>{towns.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">From</span><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" /></label>
          <label><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">To</span><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" /></label>
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3"><div className="font-semibold text-slate-900">{loading ? "Loading Duty Checks..." : rows.length + " Duty Check records"}</div><div className="text-xs text-slate-500">Times shown in Asia/Manila</div></div>
        {!loading && rows.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No Duty Check records match the selected filters.</div> : null}
        {rows.length > 0 ? <div className="overflow-x-auto"><table className="min-w-[1300px] w-full text-sm"><thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600"><tr><th className="p-3 text-left">Driver</th><th className="p-3 text-left">Town / vehicle</th><th className="p-3 text-left">Duty Check</th><th className="p-3 text-left">Created / expires</th><th className="p-3 text-left">Device fetch</th><th className="p-3 text-left">Response</th><th className="p-3 text-left">Device / notes</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.id} className="border-t border-slate-200 align-top">
            <td className="p-3"><div className="font-semibold text-slate-950">{row.driver_name}</div>{row.callsign ? <div className="text-xs text-slate-600">Callsign: {row.callsign}</div> : null}<div className="mt-1 font-mono text-[11px] text-slate-500">{row.driver_id}</div><div className={(String(row.online_status || "").toLowerCase() === "online" ? "text-emerald-700" : "text-slate-500") + " mt-1 text-xs font-semibold"}>{String(row.online_status || "unknown").toUpperCase()}</div></td>
            <td className="p-3"><div className="font-medium text-slate-900">{row.municipality || "-"}</div><div className="text-xs text-slate-500">{row.vehicle_type || "Vehicle not recorded"}</div>{row.phone ? <div className="mt-1 text-xs text-slate-600">{row.phone}</div> : null}</td>
            <td className="p-3"><span className={"inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold " + statusClass(row.status)}>{String(row.status || "").toUpperCase()}</span><div className="mt-2 text-xs text-slate-600">Result: {row.response_result || "-"}</div><div className="text-xs text-slate-500">Fetch count: {row.fetch_count || 0}</div></td>
            <td className="p-3 text-xs"><div><span className="font-semibold">Created:</span> {manilaTime(row.created_at)}</div><div className="mt-1"><span className="font-semibold">Expires:</span> {manilaTime(row.expires_at)}</div>{row.expired_at ? <div className="mt-1 text-rose-700"><span className="font-semibold">Expired:</span> {manilaTime(row.expired_at)}</div> : null}</td>
            <td className="p-3 text-xs"><div className={row.was_fetched ? "text-emerald-700" : "text-rose-700"}>{row.was_fetched ? "Fetched by device" : "Never fetched"}</div><div className="mt-1">First seen: {manilaTime(row.first_seen_at)}</div><div>Fetch delay: {duration(row.fetch_delay_seconds)}</div><div>Last fetch: {manilaTime(row.last_fetched_at)}</div></td>
            <td className="p-3 text-xs"><div>Responded: {manilaTime(row.responded_at)}</div><div className="mt-1 font-semibold text-slate-800">Response time: {duration(row.response_seconds)}</div></td>
            <td className="p-3 text-xs"><div className="font-mono text-[11px] text-slate-600">{row.response_device_id || "-"}</div><div className="mt-2 max-w-xs whitespace-pre-wrap text-slate-600">{row.notes || "-"}</div><div className="mt-2 font-mono text-[10px] text-slate-400">{row.id}</div></td>
          </tr>)}
        </tbody></table></div> : null}
      </section>
    </div>
  </main>;
}
