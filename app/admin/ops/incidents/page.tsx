"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type AnyObj = Record<string, any>;
type Trip = AnyObj;

function safeArr<T>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
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

function norm(v: any): string {
  return String(v ?? "").toLowerCase().trim();
}

function truthy(v: any): boolean {
  const s = norm(v);
  return s === "1" || s === "true" || s === "yes" || s === "y";
}

function parseDateSafe(v: any): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  return d;
}

function pickTripDate(t: AnyObj): { date: Date | null; field: string | null } {
  const fields = ["created_at", "requested_at", "pickup_time", "inserted_at", "updated_at"];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(t, f)) {
      const d = parseDateSafe(t[f]);
      if (d) return { date: d, field: f };
    }
  }
  return { date: null, field: null };
}

function getBookingLabel(t: AnyObj): string {
  return String(t.booking_code || t.code || t.reference || t.id || t.booking_id || "").trim() || "(unknown)";
}

function hasDriver(t: AnyObj): boolean {
  return !!(t.driver_id || t.assigned_driver_id || t.driver_name || t.driver?.id || t.driver?.name);
}

function minutesAgo(d: Date): number {
  const ms = Date.now() - d.getTime();
  return Math.floor(ms / 60000);
}

function fmtAge(mins: number): string {
  if (!Number.isFinite(mins) || mins < 0) return "";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return `${h}h ${m}m`;
  const days = Math.floor(h / 24);
  const hh = h % 24;
  return `${days}d ${hh}h`;
}

type Row = {
  label: string;
  status: string;
  age: string;
  rawAgeMins: number;
  dateField: string | null;
  links: { href: string; text: string }[];
};

function buildRow(t: AnyObj, d: Date | null, dateField: string | null): Row {
  const label = getBookingLabel(t);
  const status = String(t.status || "").trim() || "(no status)";
  const mins = d ? minutesAgo(d) : -1;
  const age = d ? fmtAge(mins) : "N/A";

  const links = [
    { href: "/admin/livetrips", text: "LiveTrips" },
    { href: "/admin/audit", text: "Audit" },
    { href: "/admin/trips/at-risk", text: "At-Risk" },
    { href: "/admin/ops/stuck-drivers", text: "Stuck Drivers" },
  ];

  return { label, status, age, rawAgeMins: mins, dateField, links };
}

export default function OpsIncidentLogPage() {
  const [raw, setRaw] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // thresholds (UI-only)
  const [unassignedMins, setUnassignedMins] = useState(20); // default 20 mins
  const [recentCancelHours, setRecentCancelHours] = useState(24); // default 24h

  async function loadSnapshot() {
    setLoading(true);
    setErr(null);
    setRaw(null);
    try {
      const r = await fetch("/api/admin/livetrips/page-data", { method: "GET", cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error((j && (j.error || j.message)) || `HTTP ${r.status}`);
      setRaw(j);
    } catch (e: any) {
      setErr(String(e?.message || e || "Failed to load snapshot"));
    } finally {
      setLoading(false);
    }
  }

  const trips = useMemo(() => parseTrips(raw), [raw]);

  const buckets = useMemo(() => {
    const stuck: Row[] = [];
    const unassigned: Row[] = [];
    const atRisk: Row[] = [];
    const cancelledRecent: Row[] = [];

    let usedDateField: string | null = null;
    let missingDates = 0;

    const cancelCutoffMs = Date.now() - recentCancelHours * 3600 * 1000;

    for (const t of trips) {
      const st = norm(t.status);
      const picked = pickTripDate(t);
      if (!usedDateField && picked.field) usedDateField = picked.field;

      if (!picked.date) missingDates++;

      const d = picked.date;

      // Stuck / Problem (best-effort flags)
      const isStuck =
        truthy(t.stuck) ||
        truthy(t.is_stuck) ||
        truthy(t.driver_stuck) ||
        truthy(t.is_problem) ||
        st === "stuck" ||
        st === "problem";
      if (isStuck) stuck.push(buildRow(t, d, picked.field));

      // At-risk (SLA) (best-effort flags)
      const isAtRisk =
        truthy(t.at_risk) ||
        truthy(t.is_at_risk) ||
        truthy(t.sla_at_risk) ||
        st === "at_risk";
      if (isAtRisk) atRisk.push(buildRow(t, d, picked.field));

      // Unassigned too long: requested + no driver + age >= threshold
      if (st === "requested" && !hasDriver(t) && d) {
        const mins = minutesAgo(d);
        if (mins >= unassignedMins) unassigned.push(buildRow(t, d, picked.field));
      }

      // Cancelled recent
      if ((st === "cancelled" || st === "canceled") && d) {
        if (d.getTime() >= cancelCutoffMs) cancelledRecent.push(buildRow(t, d, picked.field));
      }
    }

    const sortByAgeDesc = (a: Row, b: Row) => (b.rawAgeMins - a.rawAgeMins);

    stuck.sort(sortByAgeDesc);
    unassigned.sort(sortByAgeDesc);
    atRisk.sort(sortByAgeDesc);
    cancelledRecent.sort(sortByAgeDesc);

    return { stuck, unassigned, atRisk, cancelledRecent, usedDateField, missingDates };
  }, [trips, unassignedMins, recentCancelHours]);

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

  function Table({ rows }: { rows: Row[] }) {
    if (!rows.length) return <div style={{ marginTop: 8, fontSize: 13, opacity: 0.7 }}>No items.</div>;

    return (
      <div style={{ marginTop: 10, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e5e7eb" }}>Booking</th>
              <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e5e7eb" }}>Status</th>
              <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e5e7eb" }}>Age</th>
              <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e5e7eb" }}>Links</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f4f6", fontWeight: 800 }}>{r.label}</td>
                <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f4f6" }}>{r.status}</td>
                <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f4f6" }}>{r.age}</td>
                <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {r.links.map((l, idx) => (
                      <Link key={idx} href={l.href} style={{ ...btn, padding: "4px 8px", fontSize: 12 }}>
                        {l.text}
                      </Link>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Ops Incident Log (Read-only)</h1>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
        Derived incident buckets from LiveTrips page-data snapshot. Loads only on click (GET only).
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={loading ? btnDisabled : btn} onClick={loadSnapshot} disabled={loading}>
          {loading ? "Loading snapshot..." : "Load snapshot (GET)"}
        </button>

        <Link href="/admin/control-center" style={btn}>Back to Control Center</Link>
        <Link href="/admin/livetrips" style={btn}>Open LiveTrips</Link>
        <Link href="/admin/audit" style={btn}>Open Audit</Link>
      </div>

      {err ? (
        <div style={{ ...card, marginTop: 12, borderColor: "#fecaca", background: "#fff1f2" }}>
          <div style={{ fontWeight: 800 }}>Error</div>
          <div style={{ marginTop: 6, opacity: 0.9 }}>{err}</div>
        </div>
      ) : null}

      <div style={{ marginTop: 12, ...card }}>
        <div style={{ fontWeight: 800 }}>Filters (UI-only)</div>
        <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontSize: 13, opacity: 0.8 }}>Unassigned threshold (minutes)</div>
          <input
            type="number"
            min={1}
            value={unassignedMins}
            onChange={(e) => setUnassignedMins(Math.max(1, Number(e.target.value || 0)))}
            style={{ padding: 8, border: "1px solid #d1d5db", borderRadius: 10, width: 120 }}
          />

          <div style={{ fontSize: 13, opacity: 0.8 }}>Cancelled recent (hours)</div>
          <input
            type="number"
            min={1}
            value={recentCancelHours}
            onChange={(e) => setRecentCancelHours(Math.max(1, Number(e.target.value || 0)))}
            style={{ padding: 8, border: "1px solid #d1d5db", borderRadius: 10, width: 120 }}
          />
        </div>

        {raw ? (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
            Snapshot rows: <b>{trips.length}</b> Â· Date field used (best-effort): <b>{buckets.usedDateField || "N/A"}</b>
            {buckets.missingDates ? <> Â· Rows missing dates: <b>{buckets.missingDates}</b></> : null}
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>
            No snapshot loaded yet. Click <b>Load snapshot (GET)</b>.
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, ...card }}>
        <div style={{ fontWeight: 900 }}>Stuck / Problem</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Flags: stuck/is_stuck/driver_stuck/is_problem OR status stuck/problem</div>
        <Table rows={buckets.stuck} />
      </div>

      <div style={{ marginTop: 12, ...card }}>
        <div style={{ fontWeight: 900 }}>Unassigned Too Long</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>status=requested, no driver, age &ge; threshold</div>
        <Table rows={buckets.unassigned} />
      </div>

      <div style={{ marginTop: 12, ...card }}>
        <div style={{ fontWeight: 900 }}>At-Risk (SLA)</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Flags: at_risk/is_at_risk/sla_at_risk OR status=at_risk</div>
        <Table rows={buckets.atRisk} />
      </div>

      <div style={{ marginTop: 12, ...card }}>
        <div style={{ fontWeight: 900 }}>Cancelled (Recent)</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>status=cancelled/canceled within cutoff</div>
        <Table rows={buckets.cancelledRecent} />
      </div>

      <div style={{ marginTop: 14, fontSize: 12, opacity: 0.7 }}>
        Locked rule: read-only UI. GET-only on click. No wallet mutations. No Mapbox changes. No LiveTrips logic changes.
      </div>
    </div>
  );
}