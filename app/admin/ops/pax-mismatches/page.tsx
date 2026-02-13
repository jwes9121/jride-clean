"use client";

import { useEffect, useState } from "react";

type Row = {
  ride_id: string;
  driver_id: string;
  matches: boolean;
  booked_pax: string | null;
  actual_pax: string | null;
  reason: string | null;
  note: string | null;
  created_at: string;
};

export default function PaxMismatchesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      try {
        setErr("");
        setLoading(true);
        const res = await fetch("/api/admin/pax-mismatches?limit=200");
        const j = await res.json().catch(() => ({} as any));
        if (!res.ok || !j?.ok) {
          setErr(String(j?.error || "LOAD_FAILED"));
          setRows([]);
          return;
        }
        setRows((j.rows || []) as Row[]);
      } catch (e: any) {
        setErr(String(e?.message || "LOAD_FAILED"));
        setRows([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="p-4">
      <div className="text-xl font-extrabold">PAX Mismatches</div>
      <div className="mt-1 text-xs opacity-70">Read-only list of driver-reported passenger count mismatches.</div>

      {loading ? (
        <div className="mt-4 text-sm opacity-70">Loading...</div>
      ) : err ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          Failed to load: <span className="font-mono">{err}</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-4 text-sm opacity-70">No mismatches found.</div>
      ) : (
        <div className="mt-4 overflow-auto rounded-2xl border border-black/10 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 text-left">
              <tr>
                <th className="p-2">Created</th>
                <th className="p-2">Ride</th>
                <th className="p-2">Driver</th>
                <th className="p-2">Booked</th>
                <th className="p-2">Actual</th>
                <th className="p-2">Reason</th>
                <th className="p-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.ride_id + ":" + r.created_at + ":" + i} className="border-t">
                  <td className="p-2 whitespace-nowrap">{r.created_at}</td>
                  <td className="p-2 font-mono whitespace-nowrap">{r.ride_id}</td>
                  <td className="p-2 font-mono whitespace-nowrap">{r.driver_id}</td>
                  <td className="p-2 whitespace-nowrap">{r.booked_pax ?? "--"}</td>
                  <td className="p-2 whitespace-nowrap">{r.actual_pax ?? "--"}</td>
                  <td className="p-2 whitespace-nowrap">{r.reason ?? "--"}</td>
                  <td className="p-2">{r.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 text-[11px] opacity-70">
        Security note: this page reads from a server route that uses Service Role. Add auth gating when ready.
      </div>
    </div>
  );
}