"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type TripRow = {
  id?: string | number | null;
  uuid?: string | null;
  booking_id?: string | null;
  booking_code?: string | null;
  status?: string | null;

  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;

  pickup_label?: string | null;
  dropoff_label?: string | null;

  driver_id?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;

  town?: string | null;

  updated_at?: string | null;
  created_at?: string | null;

  [k: string]: any;
};

type Banner = { kind: "ok" | "warn" | "err"; text: string } | null;

const STUCK_THRESHOLDS_MIN = {
  on_the_way: 15,
  on_trip: 25,
};

function normStatus(s?: any) {
  return String(s || "").trim().toLowerCase();
}

function safeArray<T>(v: any): T[] {
  if (!v) return [];
  if (Array.isArray(v)) return v as T[];
  return [];
}

function parseTripsFromPageData(j: any): TripRow[] {
  if (!j) return [];
  const candidates = [j.trips, j.bookings, j.data, j["0"], Array.isArray(j) ? j : null];
  for (const c of candidates) {
    const arr = safeArray<TripRow>(c);
    if (arr.length) return arr;
  }
  return [];
}

function minutesSince(iso?: string | null): number {
  if (!iso) return 999999;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 999999;
  const now = Date.now();
  return Math.floor((now - t) / 60000);
}

function isActiveTripStatus(s: string) {
  // Keep aligned to existing LiveTripsClient logic (no guessing of extra statuses)
  return ["pending", "assigned", "on_the_way", "on_trip"].includes(s);
}

function hasFinite(n: any): boolean {
  return Number.isFinite(Number(n));
}

function computeAtRiskReason(t: TripRow): { at_risk: boolean; reason: string | null; mins: number } {
  const s = normStatus(t.status);
  const mins = minutesSince(t.updated_at || t.created_at || null);

  const hasPickup = hasFinite(t.pickup_lat) && hasFinite(t.pickup_lng);
  const hasDropoff = hasFinite(t.dropoff_lat) && hasFinite(t.dropoff_lng);
  const missingCoords = isActiveTripStatus(s) && (!hasPickup || !hasDropoff);

  const stuckOnTheWay = s === "on_the_way" && mins >= STUCK_THRESHOLDS_MIN.on_the_way;
  const stuckOnTrip = s === "on_trip" && mins >= STUCK_THRESHOLDS_MIN.on_trip;

  if (stuckOnTheWay) return { at_risk: true, reason: `STUCK: on_the_way >= ${STUCK_THRESHOLDS_MIN.on_the_way} min`, mins };
  if (stuckOnTrip) return { at_risk: true, reason: `STUCK: on_trip >= ${STUCK_THRESHOLDS_MIN.on_trip} min`, mins };
  if (missingCoords) return { at_risk: true, reason: "DATA: missing pickup/dropoff coordinates", mins };

  return { at_risk: false, reason: null, mins };
}

function pickBookingCode(t: TripRow): string {
  const v = t.booking_code ?? (t as any).bookingCode ?? (t as any).code ?? null;
  return String(v || "").trim();
}

function pickTripId(t: TripRow): string {
  const v = t.uuid ?? t.id ?? t.booking_id ?? null;
  return String(v || "").trim();
}

function normalizeErr(e: any): string {
  const raw = (e?.message || e?.error || String(e || "")).trim();
  if (!raw) return "Request failed.";
  if (raw.length > 320) return raw.slice(0, 320) + "...";
  return raw;
}

export default function AtRiskTripsPage() {
  const [rows, setRows] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "assigned" | "on_the_way" | "on_trip">("all");

  async function load() {
    setLoading(true);
    setBanner(null);
    try {
      const r = await fetch("/api/admin/livetrips/page-data?debug=0", { cache: "no-store" });
      const j: any = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.message || j?.error || "Failed to load LiveTrips page-data");
      const trips = parseTripsFromPageData(j);
      setRows(trips);
      setBanner({ kind: "ok", text: `Loaded ${trips.length} trip(s).` });
    } catch (e: any) {
      setRows([]);
      setBanner({ kind: "err", text: normalizeErr(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const atRisk = useMemo(() => {
    const out: Array<TripRow & { __mins: number; __reason: string; __status: string; __code: string; __id: string }> = [];
    for (const t of rows) {
      const status = normStatus(t.status);
      if (statusFilter !== "all" && status !== statusFilter) continue;

      const { at_risk, reason, mins } = computeAtRiskReason(t);
      if (!at_risk || !reason) continue;

      const code = pickBookingCode(t);
      const id = pickTripId(t);

      // optional client-side search (booking code, driver, labels, town)
      const hay = [
        code, id, status,
        String(t.driver_name || ""),
        String(t.driver_phone || ""),
        String(t.driver_id || ""),
        String(t.pickup_label || ""),
        String(t.dropoff_label || ""),
        String(t.town || ""),
        reason,
      ].join(" ").toLowerCase();

      const qq = q.trim().toLowerCase();
      if (qq && !hay.includes(qq)) continue;

      out.push(Object.assign({}, t, { __mins: mins, __reason: reason, __status: status, __code: code, __id: id }));
    }

    // Sort: most overdue first
    out.sort((a, b) => (b.__mins - a.__mins));
    return out;
  }, [rows, q, statusFilter]);

  const btn: any = {
    padding: "6px 10px",
    border: "1px solid #ddd",
    borderRadius: 10,
    background: "white",
    cursor: "pointer",
    fontSize: 12,
    textDecoration: "none",
    display: "inline-block",
  };
  const btnDisabled: any = { ...btn, opacity: 0.5, cursor: "not-allowed" };

  const badge: any = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid #eee",
    fontSize: 11,
    opacity: 0.85,
  };

  const bannerStyle = (k: "ok" | "warn" | "err") =>
    ({
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid #e5e7eb",
      marginTop: 12,
      background: k === "ok" ? "#ecfdf5" : k === "warn" ? "#fffbeb" : "#fef2f2",
      color: k === "ok" ? "#065f46" : k === "warn" ? "#92400e" : "#991b1b",
      fontSize: 14,
      maxWidth: 1100,
      whiteSpace: "pre-wrap",
    } as any);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>At-Risk Trips (Read-only)</h1>
      <div style={{ marginTop: 6, opacity: 0.7, fontSize: 12 }}>
        Flags stuck trips and missing coordinates using the same thresholds as LiveTrips. No actions here.
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>
          Status:&nbsp;
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="all">all</option>
            <option value="pending">pending</option>
            <option value="assigned">assigned</option>
            <option value="on_the_way">on_the_way</option>
            <option value="on_trip">on_trip</option>
          </select>
        </label>

        <label style={{ fontSize: 12 }}>
          Search:&nbsp;
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="booking_code, driver, town, reason..."
            style={{ width: 360 }}
          />
        </label>

        <button style={loading ? btnDisabled : btn} disabled={loading} onClick={load}>Refresh</button>
        {loading ? <span style={{ opacity: 0.7 }}>Loading...</span> : null}

        <span style={{ opacity: 0.6 }}>|</span>

        <span style={{ fontSize: 12 }}>
          Showing <b>{atRisk.length}</b> at-risk trip(s)
        </span>

        <span style={{ opacity: 0.6 }}>|</span>

        <Link href="/admin/livetrips" style={btn}>Open LiveTrips</Link>
      </div>

      {banner ? <div style={bannerStyle(banner.kind)}>{banner.text}</div> : null}

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1050 }}>
          <thead>
            <tr>
              {["mins", "status", "reason", "booking_code", "driver", "town", "pickup", "dropoff", "actions"].map((h) => (
                <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8, fontSize: 12 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {atRisk.map((t: any) => {
              const code = t.__code || "";
              const id = t.__id || "";
              const status = t.__status || "";
              const mins = Number(t.__mins || 0);
              const reason = t.__reason || "";

              // Link-only: pass booking_code + id as query params (harmless if ignored)
              const href = code
                ? `/admin/livetrips?booking_code=${encodeURIComponent(code)}`
                : `/admin/livetrips?id=${encodeURIComponent(id)}`;

              const driverLabel =
                (t.driver_name ? String(t.driver_name) : "") ||
                (t.driver_phone ? String(t.driver_phone) : "") ||
                (t.driver_id ? String(t.driver_id) : "");

              return (
                <tr key={String(code || id || Math.random())}>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee", fontFamily: "monospace" }}>
                    {String(mins)}
                  </td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                    <span style={badge}>{status}</span>
                  </td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{reason}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee", fontFamily: "monospace" }}>
                    {code || "(no code)"}
                  </td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                    {driverLabel || "(unassigned)"}
                  </td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{String(t.town || "")}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{String(t.pickup_label || "")}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{String(t.dropoff_label || "")}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                    <Link href={href} style={btn}>Open in LiveTrips</Link>
                  </td>
                </tr>
              );
            })}

            {atRisk.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: 12, color: "#666" }}>
                  No at-risk trips right now.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
        Locked rule: this page is read-only. It only reads LiveTrips page-data and provides navigation links.
      </div>
    </div>
  );
}