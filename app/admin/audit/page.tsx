"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type TripRow = {
  id?: string | number | null;
  uuid?: string | null;
  booking_code?: string | null;

  status?: string | null;

  passenger_name?: string | null;
  driver_id?: string | null;
  driver_name?: string | null;

  pickup_label?: string | null;
  dropoff_label?: string | null;

  created_at?: string | null;
  updated_at?: string | null;

  [k: string]: any;
};

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

function norm(s: any) {
  return String(s || "").toLowerCase().trim();
}

function tripKey(t: TripRow) {
  return String(t.uuid || t.id || t.booking_code || "");
}

export default function AuditTrailPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [raw, setRaw] = useState<any>(null);
  const [selectedId, setSelectedId] = useState<string>("");

  const trips = useMemo(() => parseTripsFromPageData(raw), [raw]);

  const filtered = useMemo(() => {
    const qq = norm(q);
    const ss = norm(status);
    return trips.filter((t) => {
      const hay = norm(
        [
          tripKey(t),
          t.booking_code,
          t.status,
          t.passenger_name,
          t.driver_name,
          t.pickup_label,
          t.dropoff_label,
        ].join(" ")
      );
      if (qq && !hay.includes(qq)) return false;
      if (ss && norm(t.status) !== ss) return false;
      return true;
    });
  }, [trips, q, status]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return filtered.find((t) => tripKey(t) === selectedId) || trips.find((t) => tripKey(t) === selectedId) || null;
  }, [filtered, trips, selectedId]);

  async function loadSnapshot() {
    setLoading(true);
    setErr(null);
    setRaw(null);
    setSelectedId("");
    try {
      // NOTE: GET only. No mutations.
      const r = await fetch("/api/admin/livetrips/page-data", { method: "GET" });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        throw new Error((j && (j.error || j.message)) || ("HTTP " + r.status));
      }
      setRaw(j);
    } catch (e: any) {
      setErr(String(e?.message || e || "Failed to load"));
    } finally {
      setLoading(false);
    }
  }

  const card: any = { border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, background: "white" };
  const btn: any = { display: "inline-block", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 10, background: "white", fontSize: 13, textDecoration: "none", cursor: "pointer" };
  const mono: any = { fontFamily: "monospace", fontSize: 12, opacity: 0.75 };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Audit Trail (Read-only)</h1>
      <div style={{ marginTop: 6, opacity: 0.75, fontSize: 13 }}>
        Snapshot helper only (UI-only). Loads current LiveTrips page-data via GET when you click the button.
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={btn} onClick={loadSnapshot} disabled={loading}>
          {loading ? "Loading snapshot..." : "Load snapshot (GET)"}
        </button>

        <Link href="/admin/control-center" style={btn}>Back to Control Center</Link>
        <Link href="/admin/livetrips" style={btn}>Open Live Trips</Link>
        <Link href="/admin/trips/at-risk" style={btn}>Open At-Risk</Link>
      </div>

      {err ? (
        <div style={{ marginTop: 12, ...card, borderColor: "#fecaca", background: "#fff1f2" }}>
          <div style={{ fontWeight: 800 }}>Error</div>
          <div style={{ marginTop: 6, opacity: 0.85 }}>{err}</div>
          <div style={{ marginTop: 10, opacity: 0.7, fontSize: 12 }}>
            If this endpoint is protected by middleware, open this page while already logged-in as admin.
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 12, ...card }}>
        <div style={{ fontWeight: 800 }}>Filters</div>
        <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 13 }}>
            Search (booking code / id / name):&nbsp;
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. JR-2026-0001" style={{ width: 320 }} />
          </label>

          <label style={{ fontSize: 13 }}>
            Status:&nbsp;
            <input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="assigned / on_the_way / on_trip" style={{ width: 220 }} />
          </label>

          <span style={{ opacity: 0.7, fontSize: 12 }}>
            Trips loaded: <b>{trips.length}</b> Â· Showing: <b>{filtered.length}</b>
          </span>
        </div>

        {!raw ? (
          <div style={{ marginTop: 12, opacity: 0.7, fontSize: 13 }}>
            No snapshot loaded yet. Click <b>Load snapshot (GET)</b>.
          </div>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {filtered.slice(0, 60).map((t) => {
              const id = tripKey(t);
              const active = selectedId === id;
              return (
                <button
                  key={id || Math.random()}
                  type="button"
                  onClick={() => setSelectedId(id)}
                  style={{
                    textAlign: "left",
                    padding: 10,
                    borderRadius: 10,
                    border: active ? "2px solid #10b981" : "1px solid #e5e7eb",
                    background: active ? "#ecfdf5" : "white",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ fontWeight: 800 }}>{t.booking_code || id || "(no id)"}</div>
                    <span style={mono}>status={String(t.status || "")}</span>
                    {t.driver_name ? <span style={{ opacity: 0.8, fontSize: 12 }}>driver: {t.driver_name}</span> : null}
                  </div>
                  <div style={{ marginTop: 4, opacity: 0.8, fontSize: 12 }}>
                    {t.pickup_label ? `PU: ${t.pickup_label}` : "PU: â€”"}{" "}
                    {t.dropoff_label ? `Â· DO: ${t.dropoff_label}` : "Â· DO: â€”"}
                  </div>
                </button>
              );
            })}

            {filtered.length > 60 ? (
              <div style={{ opacity: 0.7, fontSize: 12 }}>
                Showing first 60 results only. Narrow the search to find a specific trip.
              </div>
            ) : null}
          </div>
        )}
      </div>

      {selected ? (
        <div style={{ marginTop: 12, ...card }}>
          <div style={{ fontWeight: 800 }}>Selected Trip Snapshot</div>
          <div style={{ marginTop: 6, display: "grid", gap: 6, fontSize: 13, opacity: 0.9 }}>
            <div><span style={mono}>id</span> {tripKey(selected)}</div>
            <div><span style={mono}>booking_code</span> {String(selected.booking_code || "")}</div>
            <div><span style={mono}>status</span> {String(selected.status || "")}</div>
            <div><span style={mono}>driver</span> {String(selected.driver_name || selected.driver_id || "")}</div>
            <div><span style={mono}>created_at</span> {String(selected.created_at || "")}</div>
            <div><span style={mono}>updated_at</span> {String(selected.updated_at || "")}</div>
          </div>

          <div style={{ marginTop: 10, opacity: 0.75, fontSize: 12 }}>
            Note: This is a snapshot audit helper (not a full historical timeline). Phase 11A can extend this into a real UI-only trail.
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Raw JSON (selected)</div>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#f8fafc", border: "1px solid #e5e7eb", padding: 10, borderRadius: 10 }}>
{JSON.stringify(selected, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
