"use client";

import React, { useEffect, useMemo, useState } from "react";

type Row = {
  driver_id: string;
  stuck_24h: number;
  stuck_7d: number;
  stuck_30d: number;
  open_count: number;
  avg_minutes: number;
  last_detected_at: string | null;
  _score?: number;
  _scoreKey?: string;
};

function fmt(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function StuckDriversReportPage() {
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  async function load(d: number) {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/reports/stuck-drivers?days=${d}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to load report");
      setRows(j.rows || []);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(days); }, [days]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let r = rows.slice();

    // Always sort by computed score (based on selected days), then open_count.
    r.sort((a, b) => {
      const sa = Number(a._score || 0);
      const sb = Number(b._score || 0);
      if (sb !== sa) return sb - sa;
      return Number(b.open_count || 0) - Number(a.open_count || 0);
    });

    if (!qq) return r;
    return r.filter(x => (x.driver_id || "").toLowerCase().includes(qq));
  }, [rows, q]);

  return (
    <div className="p-3 md:p-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-lg font-semibold">Stuck Driver Scorecard</div>
          <div className="text-xs text-slate-600">
            Ranks drivers by stuck events and currently open stuck alerts.
          </div>
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search driver uuid..."
            className="w-full md:w-[320px] rounded border px-3 py-2 text-sm"
          />
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
            className="rounded border px-3 py-2 text-sm"
          >
            <option value={1}>Last 24h</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button
            onClick={() => load(days)}
            className="rounded bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {err && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {err}
        </div>
      )}

      {/* Mobile cards */}
      <div className="mt-4 grid gap-2 md:hidden">
        {filtered.map((r) => (
          <div key={r.driver_id} className="rounded border p-3">
            <div className="text-xs text-slate-500">Driver</div>
            <div className="break-all font-mono text-sm">{r.driver_id}</div>

            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded bg-slate-50 p-2">
                <div className="text-[11px] text-slate-500">Open</div>
                <div className="font-semibold">{r.open_count ?? 0}</div>
              </div>
              <div className="rounded bg-slate-50 p-2">
                <div className="text-[11px] text-slate-500">Avg min</div>
                <div className="font-semibold">{r.avg_minutes ?? 0}</div>
              </div>
              <div className="rounded bg-slate-50 p-2">
                <div className="text-[11px] text-slate-500">24h</div>
                <div className="font-semibold">{r.stuck_24h ?? 0}</div>
              </div>
              <div className="rounded bg-slate-50 p-2">
                <div className="text-[11px] text-slate-500">7d</div>
                <div className="font-semibold">{r.stuck_7d ?? 0}</div>
              </div>
            </div>

            <div className="mt-2 text-xs text-slate-500">Last detected</div>
            <div className="text-sm">{fmt(r.last_detected_at)}</div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-sm text-slate-600">No rows.</div>
        )}
      </div>

      {/* Desktop table */}
      <div className="mt-4 hidden overflow-auto rounded border md:block">
        <table className="min-w-[900px] w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="p-2">driver_id</th>
              <th className="p-2">open</th>
              <th className="p-2">24h</th>
              <th className="p-2">7d</th>
              <th className="p-2">30d</th>
              <th className="p-2">avg min</th>
              <th className="p-2">last detected</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.driver_id} className="border-t">
                <td className="p-2 font-mono break-all">{r.driver_id}</td>
                <td className="p-2 font-semibold">{r.open_count ?? 0}</td>
                <td className="p-2">{r.stuck_24h ?? 0}</td>
                <td className="p-2">{r.stuck_7d ?? 0}</td>
                <td className="p-2">{r.stuck_30d ?? 0}</td>
                <td className="p-2">{r.avg_minutes ?? 0}</td>
                <td className="p-2">{fmt(r.last_detected_at)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td className="p-3 text-slate-600" colSpan={7}>No rows.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
