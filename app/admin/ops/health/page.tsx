"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type AnyObj = Record<string, any>;
type Trip = AnyObj;

function safeArr<T>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function norm(v: any): string {
  return String(v ?? "").toLowerCase().trim();
}

function parseTrips(j: any): Trip[] {
  if (!j) return [];
  const candidates = [
    j.trips,
    j.bookings,
    j.data,
    j.rows,
    j.items,
    j.result,
    j.payload,
    Array.isArray(j) ? j : null,
  ];
  for (const c of candidates) {
    const arr = safeArr<Trip>(c);
    if (arr.length) return arr;
  }
  for (const k of Object.keys(j || {})) {
    const arr = safeArr<Trip>((j as AnyObj)[k]);
    if (arr.length && typeof arr[0] === "object") return arr;
  }
  return [];
}

function truthyFlag(v: any): boolean {
  const s = norm(v);
  return s === "1" || s === "true" || s === "yes" || s === "y";
}

export default function OpsHealthDashboardPage() {
  const [raw, setRaw] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function loadSnapshot() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/livetrips/page-data", { method: "GET", cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error((j && (j.error || j.message)) || `HTTP ${r.status}`);
      setRaw(j);
    } catch (e: any) {
      setErr(String(e?.message || e || "Failed to load snapshot"));
      setRaw(null);
    } finally {
      setLoading(false);
    }
  }

  const trips = useMemo(() => parseTrips(raw), [raw]);

  const stats = useMemo(() => {
    let unassigned = 0;
    let active = 0;
    let completed = 0;
    let cancelled = 0;
    let atRisk = 0;
    let stuck = 0;

    for (const t of trips) {
      const status = norm(t.status);
      const hasDriver = !!t.driver_id || !!t.driver_name || !!t.assigned_driver_id;

      if (status === "requested" && !hasDriver) unassigned++;

      if (["assigned", "on_the_way", "arrived", "enroute", "on_trip"].includes(status)) active++;

      if (status === "completed") completed++;
      if (status === "cancelled" || status === "canceled") cancelled++;

      if (truthyFlag(t.at_risk) || truthyFlag(t.is_at_risk) || truthyFlag(t.sla_at_risk) || status === "at_risk") atRisk++;

      if (truthyFlag(t.stuck) || truthyFlag(t.is_stuck) || truthyFlag(t.driver_stuck) || truthyFlag(t.is_problem) || status === "stuck") stuck++;
    }

    return { total: trips.length, unassigned, active, atRisk, stuck, completed, cancelled };
  }, [trips]);

  const card: any = { border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, background: "white" };
  const btn: any = {
    display: "inline-block",
    padding: "8px 12px",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    background: "white",
    fontSize: 13,
    textDecoration: "none",
    cursor: "pointer",
  };
  const btnDisabled: any = { ...btn, opacity: 0.55, cursor: "not-allowed" };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Ops Health Dashboard (Read-only)</h1>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
        Snapshot-based indicators derived from LiveTrips page-data. Loads only on click (GET only).
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={loading ? btnDisabled : btn} onClick={loadSnapshot} disabled={loading}>
          {loading ? "Loading snapshot..." : "Load snapshot (GET)"}
        </button>

        <Link href="/admin/control-center" style={btn}>Back to Control Center</Link>
        <Link href="/admin/livetrips" style={btn}>Open Live Trips</Link>
        <Link href="/admin/trips/at-risk" style={btn}>Open At-Risk Trips</Link>
        <Link href="/admin/ops/stuck-drivers" style={btn}>Open Stuck Drivers</Link>
      </div>

      {err ? (
        <div style={{ ...card, marginTop: 12, borderColor: "#fecaca", background: "#fff1f2" }}>
          <div style={{ fontWeight: 800 }}>Error</div>
          <div style={{ marginTop: 6, opacity: 0.9 }}>{err}</div>
        </div>
      ) : null}

      <div style={{ marginTop: 14, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div style={card}><div style={{ fontWeight: 800 }}>Total</div><div style={{ fontSize: 28, fontWeight: 900 }}>{stats.total}</div></div>
        <div style={card}><div style={{ fontWeight: 800 }}>Unassigned</div><div style={{ fontSize: 28, fontWeight: 900 }}>{stats.unassigned}</div></div>
        <div style={card}><div style={{ fontWeight: 800 }}>Active</div><div style={{ fontSize: 28, fontWeight: 900 }}>{stats.active}</div></div>
        <div style={card}><div style={{ fontWeight: 800 }}>At-Risk</div><div style={{ fontSize: 28, fontWeight: 900 }}>{stats.atRisk}</div></div>
        <div style={card}><div style={{ fontWeight: 800 }}>Stuck / Problem</div><div style={{ fontSize: 28, fontWeight: 900 }}>{stats.stuck}</div></div>
        <div style={card}><div style={{ fontWeight: 800 }}>Completed</div><div style={{ fontSize: 28, fontWeight: 900 }}>{stats.completed}</div></div>
        <div style={card}><div style={{ fontWeight: 800 }}>Cancelled</div><div style={{ fontSize: 28, fontWeight: 900 }}>{stats.cancelled}</div></div>
      </div>

      <div style={{ marginTop: 14, fontSize: 12, opacity: 0.7 }}>
        Locked rule: read-only UI. Snapshot derived only. GET-only on click. No mutations. No LiveTrips logic changes. No Mapbox changes.
      </div>
    </div>
  );
}