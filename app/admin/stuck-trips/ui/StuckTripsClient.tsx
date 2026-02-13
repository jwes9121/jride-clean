"use client";

import React, { useEffect, useMemo, useState } from "react";

type Row = {
  log_id: number;
  driver_id: string;
  booking_uuid: string | null;
  booking_code: string | null;
  status: string | null;
  acknowledged_at: string | null;
  snooze_until: string | null;
  last_detected_at: string | null;
  last_location_at: string | null;
  times_detected: number;
};

function secondsSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

function severity(sec: number | null): "ok" | "warn" | "danger" {
  if (sec === null) return "danger";
  if (sec >= 600) return "danger";
  if (sec >= 300) return "warn";
  return "ok";
}

export default function StuckTripsClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [threshold, setThreshold] = useState(120);
  const [showAck, setShowAck] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/stuck-trips?threshold=${threshold}&showAck=${showAck ? 1 : 0}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Load failed");
      setRows(j.rows || []);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [threshold, showAck]);

  async function post(path: string, body: any) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.message || "Action failed");
    return j;
  }

  async function ack(logId: number) {
    await post("/api/admin/stuck-trips/ack", { logId });
    await load();
  }

  async function snooze(logId: number, minutes: number) {
    await post("/api/admin/stuck-trips/snooze", { logId, minutes });
    await load();
  }

  async function autoReassign(bookingCode: string, rank: number) {
    const s = await post("/api/admin/reassign/suggest", { bookingCode });
    const target = s?.drivers?.[rank];
    if (!target?.driver_id) throw new Error("No suggested driver");
    await post("/api/admin/reassign", {
      bookingCode,
      toDriverId: target.driver_id,
      reason: "auto_reassign_stuck",
    });
    await load();
  }

  const visible = useMemo(() => rows || [], [rows]);

  return (
    <div className="p-3 md:p-6">
      <div className="text-lg font-semibold">Stuck Trip Watcher</div>
      <div className="text-xs text-slate-600 mb-3">
        Flags active trips whose driver location hasn&apos;t updated for ≥ threshold.
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
        <label className="text-sm flex items-center gap-2">
          Threshold (sec):
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(parseInt(e.target.value || "120", 10))}
            className="w-28 rounded border px-2 py-1 text-sm"
          />
        </label>

        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={showAck} onChange={(e) => setShowAck(e.target.checked)} />
          Show acknowledged
        </label>

        <button
          onClick={load}
          className="rounded bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>

        <div className="text-sm text-slate-700">
          Stuck visible: <span className="font-semibold">{visible.length}</span>
        </div>
      </div>

      {err && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {err}
        </div>
      )}

      {/* MOBILE cards */}
      <div className="mt-4 grid gap-2 md:hidden">
        {visible.map((r) => {
          const sec = secondsSince(r.last_location_at || r.last_detected_at);
          const sev = severity(sec);
          const mins = sec ? Math.floor(sec / 60) : null;

          return (
            <div
              key={r.log_id}
              className={`rounded border p-3 ${sev === "danger" ? "border-red-300 bg-red-50" : sev === "warn" ? "border-amber-300 bg-amber-50" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-500">Booking</div>
                  <div className="text-sm font-semibold">{r.booking_code || "-"}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Stuck</div>
                  <div className="text-sm font-semibold">{mins !== null ? `${mins}m` : "?"}</div>
                </div>
              </div>

              <div className="mt-2 text-xs text-slate-500">Driver</div>
              <div className="font-mono text-sm break-all">{r.driver_id}</div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  className="rounded bg-emerald-600 px-3 py-3 text-sm font-semibold text-white"
                  onClick={() => autoReassign(r.booking_code || "", 0)}
                  disabled={!r.booking_code}
                >
                  Auto Reassign (Best)
                </button>
                <button
                  className="rounded bg-emerald-700 px-3 py-3 text-sm font-semibold text-white"
                  onClick={() => autoReassign(r.booking_code || "", 1)}
                  disabled={!r.booking_code}
                >
                  2nd
                </button>

                <button
                  className="rounded bg-slate-800 px-3 py-3 text-sm font-semibold text-white"
                  onClick={() => ack(r.log_id)}
                >
                  Ack
                </button>
                <button
                  className="rounded bg-amber-600 px-3 py-3 text-sm font-semibold text-white"
                  onClick={() => snooze(r.log_id, 10)}
                >
                  Snooze 10m
                </button>
              </div>
            </div>
          );
        })}

        {visible.length === 0 && (
          <div className="text-sm text-slate-600">No stuck trips detected.</div>
        )}
      </div>

      {/* DESKTOP table */}
      <div className="mt-4 hidden overflow-auto rounded border md:block">
        <table className="min-w-[980px] w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="p-2">booking</th>
              <th className="p-2">status</th>
              <th className="p-2">driver</th>
              <th className="p-2">since last loc</th>
              <th className="p-2">ack</th>
              <th className="p-2">actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const sec = secondsSince(r.last_location_at || r.last_detected_at);
              const mins = sec ? Math.floor(sec / 60) : null;

              return (
                <tr key={r.log_id} className="border-t">
                  <td className="p-2 font-semibold">{r.booking_code || "-"}</td>
                  <td className="p-2">{r.status || "-"}</td>
                  <td className="p-2 font-mono break-all">{r.driver_id}</td>
                  <td className="p-2">{mins !== null ? `${mins}m` : "?"}</td>
                  <td className="p-2">{r.acknowledged_at ? "yes" : "no"}</td>
                  <td className="p-2 flex flex-wrap gap-2">
                    <button className="rounded bg-emerald-600 px-3 py-2 text-xs font-semibold text-white" onClick={() => autoReassign(r.booking_code || "", 0)} disabled={!r.booking_code}>
                      Auto Best
                    </button>
                    <button className="rounded bg-emerald-700 px-3 py-2 text-xs font-semibold text-white" onClick={() => autoReassign(r.booking_code || "", 1)} disabled={!r.booking_code}>
                      2nd
                    </button>
                    <button className="rounded bg-slate-800 px-3 py-2 text-xs font-semibold text-white" onClick={() => ack(r.log_id)}>
                      Ack
                    </button>
                    <button className="rounded bg-amber-600 px-3 py-2 text-xs font-semibold text-white" onClick={() => snooze(r.log_id, 10)}>
                      Snooze 10m
                    </button>
                  </td>
                </tr>
              );
            })}

            {visible.length === 0 && (
              <tr><td className="p-3 text-slate-600" colSpan={6}>No stuck trips detected.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-slate-500">
        Severity: WARN ≥ 5 minutes, DANGER ≥ 10 minutes.
      </div>
    </div>
  );
}
