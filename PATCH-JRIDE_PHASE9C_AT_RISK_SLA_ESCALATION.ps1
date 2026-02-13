# PATCH-JRIDE_PHASE9C_AT_RISK_SLA_ESCALATION.ps1
# Phase 9C: SLA Timers + Escalation View (READ-ONLY) — FULL FILE REWRITE (SAFE)
#
# Enhances:
#   app/admin/trips/at-risk/page.tsx
#
# Adds (READ-ONLY):
# - SLA remaining time (mins_to_breach)
# - Escalation bucket (WARNING/HIGH/CRITICAL) + filter
# - Sort modes (most overdue, nearest breach, by status)
# - Optional "only active statuses" toggle
#
# LOCKED:
# - NO wallet mutations
# - NO payout logic
# - NO schema changes
# - NO LiveTrips/Mapbox edits (links only)

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }

$root = (Get-Location).Path
$file = Join-Path $root "app\admin\trips\at-risk\page.tsx"

if (!(Test-Path -LiteralPath $file)) {
  Fail "Target file not found: $file"
}

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$file.bak.$ts"
Copy-Item -LiteralPath $file -Destination $bak -Force
Ok "[OK] Backup: $bak"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$tsx = @'
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

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

const SLA_BASE_MIN: Record<string, number> = {
  on_the_way: 15,
  on_trip: 25,
  assigned: 8,
  pending: 10,
};

// "At-risk" triggers at base threshold. Escalation uses multiples of base.
type Severity = "warn" | "high" | "critical";
function severity(mins: number, base: number): Severity {
  if (mins >= base * 3) return "critical";
  if (mins >= base * 2) return "high";
  return "warn";
}
function sevColor(sev: Severity) {
  if (sev === "critical") return "#dc2626";
  if (sev === "high") return "#ea580c";
  return "#ca8a04";
}

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
  const candidates = [j.trips, j.bookings, j.data, Array.isArray(j) ? j : null];
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

function hasFinite(n: any): boolean {
  return Number.isFinite(Number(n));
}

function isActiveTripStatus(s: string) {
  return ["pending", "assigned", "on_the_way", "on_trip"].includes(s);
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

function baseForStatus(status: string): number {
  return SLA_BASE_MIN[status] ?? 10;
}

function computeAtRisk(t: TripRow) {
  const status = normStatus(t.status);
  const mins = minutesSince(t.updated_at || t.created_at || null);
  const base = baseForStatus(status);

  const hasPickup = hasFinite(t.pickup_lat) && hasFinite(t.pickup_lng);
  const hasDropoff = hasFinite(t.dropoff_lat) && hasFinite(t.dropoff_lng);
  const missingCoords = isActiveTripStatus(status) && (!hasPickup || !hasDropoff);

  const atRiskByTime = isActiveTripStatus(status) && mins >= base;
  const atRiskByData = missingCoords;

  const at_risk = atRiskByTime || atRiskByData;
  const sev = severity(mins, base);

  const mins_to_breach = Math.max(base - mins, 0);
  const breach = mins >= base;

  let reason: string | null = null;
  if (missingCoords) reason = "DATA: missing pickup/dropoff coordinates";
  else if (breach) reason = `SLA: ${status} >= ${base} min`;

  return { status, mins, base, mins_to_breach, breach, at_risk, sev, reason };
}

export default function AtRiskTripsPage() {
  const [rows, setRows] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "assigned" | "on_the_way" | "on_trip">("all");
  const [sevFilter, setSevFilter] = useState<"all" | Severity>("all");
  const [onlyActive, setOnlyActive] = useState(true);

  const [sortMode, setSortMode] = useState<"most_overdue" | "nearest_breach" | "status_then_time">("most_overdue");

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<any>(null);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1200);
  }

  async function copyText(label: string, v: string) {
    try {
      if (!v) return;
      await navigator.clipboard.writeText(v);
      showToast(`${label} copied`);
    } catch {
      showToast("Copy failed");
    }
  }

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

  const computed = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const out: Array<any> = [];

    for (const t of rows) {
      const code = pickBookingCode(t);
      const id = pickTripId(t);

      const c = computeAtRisk(t);
      const status = c.status;

      if (onlyActive && !isActiveTripStatus(status)) continue;
      if (statusFilter !== "all" && status !== statusFilter) continue;
      if (sevFilter !== "all" && c.sev !== sevFilter) continue;

      // NOTE: Phase 9C shows both "at_risk" (SLA breach or data issue) and "near breach"
      // We'll include near-breach (within 3 mins) even if not yet at_risk, to enable prevention.
      const near = isActiveTripStatus(status) && !c.breach && c.mins_to_breach <= 3;
      const include = c.at_risk || near;

      if (!include) continue;

      const reason = c.reason || (near ? `NEAR SLA: ${status} in ${c.mins_to_breach} min` : "AT_RISK");

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

      if (qq && !hay.includes(qq)) continue;

      out.push({
        ...t,
        __code: code,
        __id: id,
        __status: status,
        __mins: c.mins,
        __base: c.base,
        __mins_to_breach: c.mins_to_breach,
        __breach: c.breach,
        __sev: c.sev,
        __reason: reason,
        __near: near,
      });
    }

    // sorting
    if (sortMode === "most_overdue") {
      out.sort((a, b) => (b.__mins - a.__mins));
    } else if (sortMode === "nearest_breach") {
      out.sort((a, b) => (a.__mins_to_breach - b.__mins_to_breach));
    } else {
      // status_then_time
      const rank: Record<string, number> = { pending: 1, assigned: 2, on_the_way: 3, on_trip: 4 };
      out.sort((a, b) => {
        const ra = rank[a.__status] ?? 99;
        const rb = rank[b.__status] ?? 99;
        if (ra !== rb) return ra - rb;
        return b.__mins - a.__mins;
      });
    }

    return out;
  }, [rows, q, statusFilter, sevFilter, onlyActive, sortMode]);

  const counts = useMemo(() => {
    const c = { warn: 0, high: 0, critical: 0, near: 0 };
    for (const r of computed) {
      if (r.__near) c.near++;
      if (r.__sev === "warn") c.warn++;
      if (r.__sev === "high") c.high++;
      if (r.__sev === "critical") c.critical++;
    }
    return c;
  }, [computed]);

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
    opacity: 0.9,
    whiteSpace: "nowrap",
  };

  const miniBtn: any = {
    padding: "2px 8px",
    border: "1px solid #ddd",
    borderRadius: 10,
    background: "white",
    cursor: "pointer",
    fontSize: 11,
    lineHeight: "18px",
  };

  const toastStyle: any = {
    position: "fixed",
    right: 16,
    bottom: 16,
    zIndex: 9999,
    background: "#111827",
    color: "white",
    padding: "10px 12px",
    borderRadius: 12,
    fontSize: 13,
    opacity: 0.95,
    boxShadow: "0 6px 18px rgba(0,0,0,0.15)",
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
      maxWidth: 1200,
      whiteSpace: "pre-wrap",
    } as any);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>At-Risk Trips (Read-only) — SLA & Escalation</h1>
      <div style={{ marginTop: 6, opacity: 0.7, fontSize: 12 }}>
        Phase 9C adds SLA timers and escalation buckets. No actions here. Links and copy only.
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
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
          Severity:&nbsp;
          <select value={sevFilter} onChange={(e) => setSevFilter(e.target.value as any)}>
            <option value="all">all</option>
            <option value="warn">warn</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </select>
        </label>

        <label style={{ fontSize: 12 }}>
          Sort:&nbsp;
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as any)}>
            <option value="most_overdue">most overdue</option>
            <option value="nearest_breach">nearest breach</option>
            <option value="status_then_time">status then time</option>
          </select>
        </label>

        <label style={{ fontSize: 12 }}>
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          &nbsp;only active statuses
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
          Total <b>{computed.length}</b> · Near <b>{counts.near}</b> · Warn <b>{counts.warn}</b> · High <b>{counts.high}</b> · Critical <b>{counts.critical}</b>
        </span>

        <span style={{ opacity: 0.6 }}>|</span>
        <Link href="/admin/livetrips" style={btn}>Open LiveTrips</Link>
      </div>

      {banner ? <div style={bannerStyle(banner.kind)}>{banner.text}</div> : null}
      {toast ? <div style={toastStyle}>{toast}</div> : null}

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1280 }}>
          <thead>
            <tr>
              {["sla", "mins", "to_breach", "status", "reason", "booking_code", "trip_id", "driver", "town", "actions"].map((h) => (
                <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8, fontSize: 12, whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {computed.map((t: any) => {
              const code = t.__code || "";
              const id = t.__id || "";
              const status = t.__status || "";
              const mins = Number(t.__mins || 0);
              const base = Number(t.__base || 10);
              const toBreach = Number(t.__mins_to_breach || 0);
              const reason = t.__reason || "";
              const sev: Severity = t.__sev || "warn";
              const isNear = !!t.__near;

              const href = code
                ? `/admin/livetrips?booking_code=${encodeURIComponent(code)}`
                : `/admin/livetrips?id=${encodeURIComponent(id)}`;

              const driverLabel =
                (t.driver_name ? String(t.driver_name) : "") ||
                (t.driver_phone ? String(t.driver_phone) : "") ||
                (t.driver_id ? String(t.driver_id) : "");

              const slaLabel = isNear ? "NEAR" : "BREACHED";

              return (
                <tr key={String(code || id || Math.random())}>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee", fontFamily: "monospace" }}>
                    <span style={{ ...badge, color: isNear ? "#065f46" : "#991b1b", background: isNear ? "#ecfdf5" : "#fef2f2" }}>
                      {slaLabel}
                    </span>{" "}
                    <span style={{ fontSize: 11, opacity: 0.7 }}>base {base}m</span>
                  </td>

                  <td style={{ padding: 8, borderBottom: "1px solid #eee", fontFamily: "monospace" }}>
                    <span style={{ ...badge, color: "white", border: "1px solid rgba(0,0,0,0.06)", background: sevColor(sev) }}>
                      {mins}m
                    </span>
                  </td>

                  <td style={{ padding: 8, borderBottom: "1px solid #eee", fontFamily: "monospace" }}>
                    {isNear ? `${toBreach}m` : "0m"}
                  </td>

                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                    <span style={badge}>{status}</span>
                  </td>

                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                    {reason}
                    <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.65 }}>
                      ({sev})
                    </span>
                  </td>

                  <td style={{ padding: 8, borderBottom: "1px solid #eee", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                    {code || "(no code)"}{" "}
                    {code ? <button style={miniBtn} onClick={() => copyText("booking_code", code)}>Copy</button> : null}
                  </td>

                  <td style={{ padding: 8, borderBottom: "1px solid #eee", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                    {id || "(no id)"}{" "}
                    {id ? <button style={miniBtn} onClick={() => copyText("trip_id", id)}>Copy</button> : null}
                  </td>

                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                    {driverLabel || "(unassigned)"}{" "}
                    {t.driver_id ? <button style={miniBtn} onClick={() => copyText("driver_id", String(t.driver_id))}>Copy</button> : null}
                  </td>

                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{String(t.town || "")}</td>

                  <td style={{ padding: 8, borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                    <Link href={href} style={btn}>Open LiveTrips</Link>
                    <span style={{ marginLeft: 8 }} />
                    <button
                      style={miniBtn}
                      onClick={() => copyText("livetrips_link", (typeof window !== "undefined" ? (window.location.origin + href) : href))}
                    >
                      Copy Link
                    </button>
                  </td>
                </tr>
              );
            })}

            {computed.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: 12, color: "#666" }}>
                  No near-breach or breached trips right now.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
        Locked rule: read-only. This page reads LiveTrips page-data and provides SLA visibility only.
      </div>
    </div>
  );
}
'@

[System.IO.File]::WriteAllText($file, $tsx, $utf8NoBom)
Ok "[DONE] Phase 9C applied (full rewrite): $file"
Ok "Open: /admin/trips/at-risk"
