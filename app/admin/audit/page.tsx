"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type AnyObj = Record<string, any>;

type TripRow = AnyObj & {
  id?: string | number | null;
  uuid?: string | null;
  booking_code?: string | null;
  status?: string | null;
};

type AuditEvent = {
  ts: number; // milliseconds since epoch
  iso: string; // ISO timestamp if available
  label: string;
  detail?: string;
  kind: "info" | "status" | "assign" | "warn";
  source?: string;
};

function safeArray<T>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function norm(v: any): string {
  return String(v ?? "").toLowerCase().trim();
}

function isIsoLike(s: any): boolean {
  if (!s) return false;
  const v = String(s);
  // Accept ISO-ish values, keep permissive
  return /^\d{4}-\d{2}-\d{2}T/.test(v) || /^\d{4}-\d{2}-\d{2} /.test(v);
}

function parseTs(v: any): number | null {
  if (!v) return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    // if seconds, convert to ms if it looks like seconds
    return v < 2_000_000_000 ? Math.floor(v * 1000) : Math.floor(v);
  }
  const s = String(v);
  const d = new Date(s);
  const t = d.getTime();
  if (Number.isFinite(t)) return t;
  return null;
}

function fmtIso(ts: number): string {
  try {
    return new Date(ts).toISOString();
  } catch {
    return String(ts);
  }
}

function tripKey(t: TripRow): string {
  return String(t.uuid || t.id || t.booking_code || "");
}

function labelizeKey(k: string): string {
  return k
    .replace(/_/g, " ")
    .replace(/\b(at)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function parseTripsFromPageData(j: any): TripRow[] {
  if (!j) return [];

  // Common containers
  const candidates = [
    j.trips,
    j.bookings,
    j.data,
    j.rows,
    j.items,
    j.result,
    j.payload,
    // If API returns array directly:
    Array.isArray(j) ? j : null,
  ];

  for (const c of candidates) {
    const arr = safeArray<TripRow>(c);
    if (arr.length) return arr;
  }

  // If nested unknown, try shallow scan:
  for (const k of Object.keys(j || {})) {
    const arr = safeArray<TripRow>((j as AnyObj)[k]);
    if (arr.length && typeof arr[0] === "object") return arr;
  }

  return [];
}

function buildEventsFromTrip(t: TripRow): AuditEvent[] {
  const ev: AuditEvent[] = [];

  const push = (e: Partial<AuditEvent> & { ts: number; label: string; kind: AuditEvent["kind"] }) => {
    ev.push({
      iso: fmtIso(e.ts),
      detail: "",
      source: "",
      ...e,
    });
  };

  const bc = String(t.booking_code || "");
  const st = String(t.status || "");

  // 1) Known-ish basics (only if present)
  const createdTs = parseTs(t.created_at);
  if (createdTs) {
    push({
      ts: createdTs,
      kind: "info",
      label: "Created",
      detail: bc ? `Booking ${bc}` : "",
    });
  }

  // 2) Assignment signals (only if present)
  const driverName = String(t.driver_name || "");
  const driverId = String(t.driver_id || "");
  const assignCandidates = [
    "assigned_at",
    "driver_assigned_at",
    "dispatch_assigned_at",
    "accepted_at",
    "driver_accepted_at",
  ];

  for (const k of assignCandidates) {
    const v = (t as AnyObj)[k];
    const ts = parseTs(v);
    if (ts) {
      const who = driverName || driverId ? `Driver: ${driverName || driverId}` : "";
      push({
        ts,
        kind: "assign",
        label: labelizeKey(k) || "Assigned",
        detail: who,
      });
    }
  }

  // 3) Status history array if it exists (no assumptions on field names)
  const historyCandidates = ["status_history", "history", "events", "audit", "timeline"];
  for (const hk of historyCandidates) {
    const arr = safeArray<any>((t as AnyObj)[hk]);
    if (!arr.length) continue;

    // attempt to parse array entries
    for (const it of arr) {
      if (!it || typeof it !== "object") continue;

      const itObj = it as AnyObj;

      const s = String(
        itObj.status ||
          itObj.state ||
          itObj.to_status ||
          itObj.next_status ||
          itObj.event ||
          itObj.type ||
          ""
      );

      const ts =
        parseTs(itObj.at) ||
        parseTs(itObj.ts) ||
        parseTs(itObj.time) ||
        parseTs(itObj.created_at) ||
        parseTs(itObj.updated_at);

      if (!ts) continue;

      const note = String(itObj.note || itObj.reason || itObj.message || itObj.detail || "");
      const src = String(itObj.source || itObj.actor || itObj.by || "");

      push({
        ts,
        kind: s ? "status" : "info",
        label: s ? `Status: ${s}` : `Event: ${labelizeKey(String(itObj.type || itObj.event || hk))}`,
        detail: note || "",
        source: src || "",
      });
    }

    // only one history list is usually enough; but don’t break if multiple exist
  }

  // 4) Generic “*_at” timestamps from the object (no schema assumptions)
  // Capture only if it looks like a date and not already captured by created/updated
  const reserved = new Set<string>(["created_at", "updated_at"]);
  for (const k of Object.keys(t || {})) {
    if (reserved.has(k)) continue;
    if (!k.endsWith("_at")) continue;

    const v = (t as AnyObj)[k];
    const ts = parseTs(v);
    if (!ts) continue;

    // avoid duplicates: if we already have an event at same ts with same label, skip
    const lbl = labelizeKey(k);
    const exists = ev.some((x) => x.ts === ts && x.label === lbl);
    if (exists) continue;

    push({
      ts,
      kind: k.includes("status") ? "status" : "info",
      label: lbl || "Timestamp",
      detail: "",
    });
  }

  // 5) Updated timestamp
  const updatedTs = parseTs(t.updated_at);
  if (updatedTs) {
    push({
      ts: updatedTs,
      kind: "info",
      label: "Last Updated",
      detail: st ? `Current status: ${st}` : "",
    });
  }

  // If nothing found, still show a minimal row
  if (!ev.length) {
    push({
      ts: Date.now(),
      kind: "warn",
      label: "No audit timestamps found for this record",
      detail: "This is a read-only view; it only shows fields already present in the data.",
    });
  }

  // Sort ascending
  ev.sort((a, b) => a.ts - b.ts);

  return ev;
}

export default function AuditTrailTimelinePage() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [raw, setRaw] = useState<any>(null);
  const [selectedId, setSelectedId] = useState<string>("");

  async function loadSnapshot() {
    setLoading(true);
    setErr(null);
    setRaw(null);
    setSelectedId("");

    try {
      // GET only; no mutations
      const r = await fetch("/api/admin/livetrips/page-data", { method: "GET", cache: "no-store" });
      const j = await r.json().catch(() => null);

      if (!r.ok) {
        throw new Error((j && (j.error || j.message)) || `HTTP ${r.status}`);
      }

      setRaw(j);
    } catch (e: any) {
      setErr(String(e?.message || e || "Failed to load"));
    } finally {
      setLoading(false);
    }
  }

  const trips = useMemo(() => parseTripsFromPageData(raw), [raw]);

  const filteredTrips = useMemo(() => {
    const qq = norm(q);
    if (!qq) return trips;

    return trips.filter((t) => {
      const hay = norm(
        [
          tripKey(t),
          t.booking_code,
          t.status,
          t.passenger_name,
          t.driver_name,
          t.driver_id,
          t.pickup_label,
          t.dropoff_label,
        ].join(" ")
      );
      return hay.includes(qq);
    });
  }, [trips, q]);

  const selectedTrip = useMemo(() => {
    if (!selectedId) return null;
    return (
      filteredTrips.find((t) => tripKey(t) === selectedId) ||
      trips.find((t) => tripKey(t) === selectedId) ||
      null
    );
  }, [filteredTrips, trips, selectedId]);

  const selectedEvents = useMemo(() => {
    if (!selectedTrip) return [];
    return buildEventsFromTrip(selectedTrip);
  }, [selectedTrip]);

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
  const mono: any = { fontFamily: "monospace", fontSize: 12, opacity: 0.75 };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Audit Trail Timeline (Read-only)</h1>
      <div style={{ marginTop: 6, opacity: 0.75, fontSize: 13 }}>
        UI-only timeline built from existing trip fields. Loads LiveTrips page-data via GET only when you click the button.
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={loading ? btnDisabled : btn} onClick={loadSnapshot} disabled={loading}>
          {loading ? "Loading snapshot..." : "Load snapshot (GET)"}
        </button>

        <Link href="/admin/control-center" style={btn}>
          Back to Control Center
        </Link>
        <Link href="/admin/livetrips" style={btn}>
          Open Live Trips
        </Link>
      </div>

      {err ? (
        <div style={{ marginTop: 12, ...card, borderColor: "#fecaca", background: "#fff1f2" }}>
          <div style={{ fontWeight: 800 }}>Error</div>
          <div style={{ marginTop: 6, opacity: 0.9 }}>{err}</div>
          <div style={{ marginTop: 8, opacity: 0.7, fontSize: 12 }}>
            If this endpoint is protected, open while already logged in as admin.
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 12, display: "grid", gap: 12, gridTemplateColumns: "420px 1fr" as any }}>
        {/* LEFT: list */}
        <div style={card}>
          <div style={{ fontWeight: 800 }}>Find a booking</div>

          <div style={{ marginTop: 10, fontSize: 13 }}>
            <div style={{ opacity: 0.8 }}>Search (booking code / id / driver / passenger):</div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="e.g. JR-2026-0001"
              style={{ width: "100%", marginTop: 6, padding: 8, borderRadius: 10, border: "1px solid #ddd" }}
            />
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
            Loaded: <b>{trips.length}</b> · Showing: <b>{filteredTrips.length}</b>
          </div>

          {!raw ? (
            <div style={{ marginTop: 12, opacity: 0.7, fontSize: 13 }}>
              No snapshot loaded yet. Click <b>Load snapshot (GET)</b>.
            </div>
          ) : filteredTrips.length === 0 ? (
            <div style={{ marginTop: 12, opacity: 0.7, fontSize: 13 }}>No matching trips found.</div>
          ) : (
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {filteredTrips.slice(0, 80).map((t) => {
                const id = tripKey(t);
                const active = selectedId === id;
                const title = String(t.booking_code || id || "(no id)");
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
                      <div style={{ fontWeight: 800 }}>{title}</div>
                      <span style={mono}>status={String(t.status || "")}</span>
                    </div>
                    <div style={{ marginTop: 4, opacity: 0.8, fontSize: 12 }}>
                      {t.driver_name ? `Driver: ${t.driver_name}` : t.driver_id ? `Driver ID: ${t.driver_id}` : "Driver: —"}
                    </div>
                    <div style={{ marginTop: 4, opacity: 0.75, fontSize: 12 }}>
                      {t.pickup_label ? `PU: ${t.pickup_label}` : "PU: —"}{" "}
                      {t.dropoff_label ? `· DO: ${t.dropoff_label}` : "· DO: —"}
                    </div>
                  </button>
                );
              })}

              {filteredTrips.length > 80 ? (
                <div style={{ opacity: 0.7, fontSize: 12 }}>
                  Showing first 80 results only. Narrow the search to find one booking.
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* RIGHT: timeline */}
        <div style={card}>
          <div style={{ fontWeight: 800 }}>Timeline</div>

          {!selectedTrip ? (
            <div style={{ marginTop: 12, opacity: 0.7, fontSize: 13 }}>
              Select a booking on the left to view its timeline.
            </div>
          ) : (
            <>
              <div style={{ marginTop: 10, display: "grid", gap: 6, fontSize: 13, opacity: 0.9 }}>
                <div>
                  <span style={mono}>booking_code</span>{" "}
                  <b>{String(selectedTrip.booking_code || "") || "—"}</b>
                </div>
                <div>
                  <span style={mono}>id</span> {tripKey(selectedTrip) || "—"}
                </div>
                <div>
                  <span style={mono}>current_status</span> {String(selectedTrip.status || "") || "—"}
                </div>
              </div>

              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {selectedEvents.map((e, idx) => (
                  <div
                    key={`${e.ts}-${idx}`}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 12,
                      padding: 12,
                      background: "white",
                    }}
                  >
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ fontWeight: 800 }}>{e.label}</div>
                      <span style={mono}>{e.iso}</span>
                      <span style={{ fontSize: 12, opacity: 0.7 }}>
                        {e.kind === "status" ? "STATUS" : e.kind === "assign" ? "ASSIGN" : e.kind === "warn" ? "WARN" : "INFO"}
                      </span>
                      {e.source ? <span style={{ fontSize: 12, opacity: 0.7 }}>· {e.source}</span> : null}
                    </div>
                    {e.detail ? <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>{e.detail}</div> : null}
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 14, opacity: 0.65, fontSize: 12 }}>
                This timeline is derived only from fields already present in the current snapshot (no DB assumptions, no writes).
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Raw JSON (selected)</div>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    fontSize: 12,
                    background: "#f8fafc",
                    border: "1px solid #e5e7eb",
                    padding: 10,
                    borderRadius: 10,
                    maxHeight: 320,
                    overflow: "auto",
                  }}
                >
{JSON.stringify(selectedTrip, null, 2)}
                </pre>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ marginTop: 14, fontSize: 12, opacity: 0.7 }}>
        Locked rule: read-only UI. GET-only on click. No mutations. No LiveTrips logic changes. No Mapbox changes.
      </div>
    </div>
  );
}
