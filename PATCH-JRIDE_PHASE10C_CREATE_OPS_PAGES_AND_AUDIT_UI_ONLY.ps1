$ErrorActionPreference = "Stop"

function Timestamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
$ts = Timestamp

function Ensure-Dir($p) {
  if (!(Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

function Backup-IfExists($path) {
  if (Test-Path $path) {
    $bak = "$path.bak.$ts"
    Copy-Item -Force $path $bak
    Write-Host "[OK] Backup: $bak"
  }
}

function Write-Utf8($path, $content) {
  Ensure-Dir (Split-Path -Parent $path)
  Set-Content -Path $path -Value $content -Encoding utf8
  Write-Host "[OK] Wrote: $path"
}

# ----------------------------
# TARGET PATHS
# ----------------------------
$controlCenter = Join-Path $PWD "app\admin\control-center\page.tsx"
$stuckDrivers  = Join-Path $PWD "app\admin\ops\stuck-drivers\page.tsx"
$autoAssignMon = Join-Path $PWD "app\admin\ops\auto-assign-monitor\page.tsx"
$walletRecon   = Join-Path $PWD "app\admin\ops\wallet-reconciliation\page.tsx"
$auditTrail    = Join-Path $PWD "app\admin\audit\page.tsx"

# ----------------------------
# BACKUPS
# ----------------------------
Backup-IfExists $controlCenter
Backup-IfExists $stuckDrivers
Backup-IfExists $autoAssignMon
Backup-IfExists $walletRecon
Backup-IfExists $auditTrail

# ----------------------------
# app/admin/control-center/page.tsx
# - Fix dispatcher filter typo
# - Keep read-only navigation only
# - Add Audit Trail button
# ----------------------------
$controlCenterContent = @'
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Item = {
  title: string;
  desc: string;
  href: string;
};

type Section = {
  heading: string;
  items: Item[];
};

type Role = "admin" | "dispatcher";

function safeNormRole(v: any): Role | null {
  const s = String(v || "").toLowerCase().trim();
  if (s === "admin") return "admin";
  if (s === "dispatcher") return "dispatcher";
  return null;
}

function getRoleFromClient(): { role: Role; debug: boolean; source: string } {
  if (typeof window === "undefined") return { role: "admin", debug: false, source: "default" };

  const sp = new URLSearchParams(window.location.search);
  const debug = sp.get("debug") === "1";

  // 1) Explicit query param override
  const qpRole = safeNormRole(sp.get("role"));
  if (qpRole) return { role: qpRole, debug, source: "query" };

  // 2) Local storage hint
  try {
    const ls = safeNormRole(window.localStorage.getItem("jride_role"));
    if (ls) return { role: ls, debug, source: "localStorage" };
  } catch {
    // ignore
  }

  // 3) Default: admin
  return { role: "admin", debug: false, source: "default" };
}

export default function AdminControlCenterPage() {
  const [role, setRole] = useState<Role>("admin");
  const [debug, setDebug] = useState(false);
  const [roleSource, setRoleSource] = useState<string>("default");

  useEffect(() => {
    const r = getRoleFromClient();
    setRole(r.role);
    setDebug(r.debug);
    setRoleSource(r.source);
  }, []);

  const sections: Section[] = useMemo(
    () => [
      {
        heading: "Core Admin",
        items: [
          {
            title: "Live Trips",
            desc: "Real-time dispatch and tracking view (navigation only).",
            href: "/admin/livetrips",
          },
          {
            title: "At-Risk Trips (SLA)",
            desc: "Trips nearing or breaching SLA thresholds (read-only).",
            href: "/admin/trips/at-risk",
          },
          {
            title: "Driver Payouts",
            desc: "Driver payout records and status overview.",
            href: "/admin/driver-payouts",
          },
          {
            title: "Vendor Payouts",
            desc: "Vendor payout records and request list.",
            href: "/admin/vendor-payouts",
          },
          {
            title: "Vendor Payout Summary",
            desc: "Read-only payout summaries per vendor.",
            href: "/admin/vendor-payouts-summary",
          },
        ],
      },

      {
        heading: "Reports",
        items: [
          {
            title: "LGU / Accounting Exports",
            desc: "Accounting and LGU export views (CSV-ready, read-only).",
            href: "/admin/reports/lgu",
          },
          {
            title: "Vendor Monthly Report",
            desc: "Monthly vendor performance and revenue summary.",
            href: "/admin/reports/vendor-monthly",
          },
          {
            title: "Vendor Summary Report",
            desc: "Overall vendor statistics and aggregates.",
            href: "/admin/reports/vendor-summary",
          },
          {
            title: "Driver Payout Requests (LGU View)",
            desc: "LGU-safe view of driver payout requests.",
            href: "/admin/reports/driver-payout-requests",
          },
        ],
      },

      {
        heading: "Quality / Operations",
        items: [
          {
            title: "Stuck Drivers",
            desc: "Drivers flagged for inactivity or stalled trips.",
            href: "/admin/ops/stuck-drivers",
          },
          {
            title: "Auto-Assign Monitor",
            desc: "Read-only monitoring of auto-assign behavior.",
            href: "/admin/ops/auto-assign-monitor",
          },
          {
            title: "Audit Trail (Read-only)",
            desc: "Snapshot audit helper (UI-only). No backend mutations.",
            href: "/admin/audit",
          },
        ],
      },

      {
        heading: "Accounting (Read-only)",
        items: [
          {
            title: "Wallet Reconciliation",
            desc: "Read-only reconciliation status dashboard placeholder.",
            href: "/admin/ops/wallet-reconciliation",
          },
        ],
      },
    ],
    []
  );

  // Dispatcher allowed links: ops-only + live + at-risk + audit helper
  const dispatcherAllow = useMemo(
    () =>
      new Set<string>([
        "/admin/livetrips",
        "/admin/trips/at-risk",
        "/admin/ops/stuck-drivers",
        "/admin/ops/auto-assign-monitor",
        "/admin/audit",
      ]),
    []
  );

  const visibleSections = useMemo(() => {
    if (role === "admin") return sections;

    // dispatcher: filter down to allowed hrefs and drop empty sections
    const filtered: Section[] = [];
    for (const s of sections) {
      const allowedItems = s.items.filter((it) => dispatcherAllow.has(it.href));
      if (allowedItems.length > 0) filtered.push({ ...s, items: allowedItems });
    }
    return filtered;
  }, [role, sections, dispatcherAllow]);

  function setRoleHint(nextRole: Role) {
    setRole(nextRole);
    setRoleSource("localStorage");
    try {
      window.localStorage.setItem("jride_role", nextRole);
    } catch {
      // ignore
    }
  }

  const card: any = {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 14,
    background: "white",
  };

  const btn: any = {
    display: "inline-block",
    padding: "8px 12px",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    background: "white",
    fontSize: 13,
    textDecoration: "none",
  };

  const miniBtn: any = {
    display: "inline-block",
    padding: "6px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    background: "white",
    fontSize: 12,
    textDecoration: "none",
    cursor: "pointer",
  };

  const badge: any = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid #eee",
    fontSize: 12,
    opacity: 0.85,
  };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Admin Control Center</h1>

      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>
        Centralized navigation hub. Read-only. No actions are executed here.
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={badge}>
          Role: <b>{role}</b>{" "}
          <span style={{ opacity: 0.7 }}>
            {debug ? "(debug)" : ""} {roleSource ? `· ${roleSource}` : ""}
          </span>
        </span>

        {debug ? (
          <>
            <button type="button" style={miniBtn} onClick={() => setRoleHint("admin")}>
              Set role: admin
            </button>
            <button type="button" style={miniBtn} onClick={() => setRoleHint("dispatcher")}>
              Set role: dispatcher
            </button>
          </>
        ) : null}

        <a href="/admin" style={btn}>
          /admin
        </a>
        <a href="/admin/control-center" style={btn}>
          /admin/control-center
        </a>
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
        {visibleSections.map((section) => (
          <div key={section.heading} style={card}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{section.heading}</div>
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {section.items.map((it) => (
                <div key={it.href} style={{ borderTop: "1px solid #f0f0f0", paddingTop: 10 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ fontWeight: 800 }}>{it.title}</div>
                    <span style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.65 }}>{it.href}</span>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 13, opacity: 0.8 }}>{it.desc}</div>
                  <div style={{ marginTop: 10 }}>
                    <Link href={it.href} style={btn}>
                      Open
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14, fontSize: 12, opacity: 0.7 }}>
        Locked rule: this page is navigation only (Link/push only). No wallet mutations. No Mapbox changes. No LiveTrips logic changes.
      </div>
    </div>
  );
}
'@

Write-Utf8 $controlCenter $controlCenterContent

# ----------------------------
# Placeholder pages (READ-ONLY)
# ----------------------------
$stuckDriversContent = @'
"use client";

import Link from "next/link";

export default function StuckDriversPage() {
  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Stuck Drivers (Read-only)</h1>
      <div style={{ marginTop: 6, opacity: 0.75, fontSize: 13 }}>
        Placeholder page to prevent routing errors. No actions. No API mutations. UI-only.
      </div>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #e5e7eb", borderRadius: 12, background: "white" }}>
        <div style={{ fontWeight: 800 }}>Next wiring (later phase)</div>
        <ul style={{ marginTop: 8, paddingLeft: 18, opacity: 0.85 }}>
          <li>Show stuck drivers list (GET-only)</li>
          <li>Link to related trips / live view</li>
          <li>No status changes from this page</li>
        </ul>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/admin/control-center" style={{ textDecoration: "none", border: "1px solid #d1d5db", padding: "8px 12px", borderRadius: 10 }}>
            Back to Control Center
          </Link>
          <Link href="/admin/livetrips" style={{ textDecoration: "none", border: "1px solid #d1d5db", padding: "8px 12px", borderRadius: 10 }}>
            Open Live Trips
          </Link>
        </div>
      </div>
    </div>
  );
}
'@

$autoAssignMonContent = @'
"use client";

import Link from "next/link";

export default function AutoAssignMonitorPage() {
  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Auto-Assign Monitor (Read-only)</h1>
      <div style={{ marginTop: 6, opacity: 0.75, fontSize: 13 }}>
        Placeholder page to prevent routing errors. No actions. No API mutations. UI-only.
      </div>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #e5e7eb", borderRadius: 12, background: "white" }}>
        <div style={{ fontWeight: 800 }}>What this will become (later)</div>
        <ul style={{ marginTop: 8, paddingLeft: 18, opacity: 0.85 }}>
          <li>Read-only auto-assign suggestion health</li>
          <li>Counts of pending vs assigned</li>
          <li>Warnings only (no assign buttons here)</li>
        </ul>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/admin/control-center" style={{ textDecoration: "none", border: "1px solid #d1d5db", padding: "8px 12px", borderRadius: 10 }}>
            Back to Control Center
          </Link>
          <Link href="/admin/livetrips" style={{ textDecoration: "none", border: "1px solid #d1d5db", padding: "8px 12px", borderRadius: 10 }}>
            Open Live Trips
          </Link>
        </div>
      </div>
    </div>
  );
}
'@

$walletReconContent = @'
"use client";

import Link from "next/link";

export default function WalletReconciliationPage() {
  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Wallet Reconciliation (Read-only)</h1>
      <div style={{ marginTop: 6, opacity: 0.75, fontSize: 13 }}>
        Placeholder page to prevent routing errors. No actions. No API mutations. UI-only.
      </div>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #e5e7eb", borderRadius: 12, background: "white" }}>
        <div style={{ fontWeight: 800 }}>Notes</div>
        <ul style={{ marginTop: 8, paddingLeft: 18, opacity: 0.85 }}>
          <li>This page will remain GET-only.</li>
          <li>No wallet deductions/credits here.</li>
          <li>Future: show computed health indicators + mismatches only.</li>
        </ul>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/admin/control-center" style={{ textDecoration: "none", border: "1px solid #d1d5db", padding: "8px 12px", borderRadius: 10 }}>
            Back to Control Center
          </Link>
        </div>
      </div>
    </div>
  );
}
'@

# ----------------------------
# app/admin/audit/page.tsx
# - UI-only audit helper
# - Fetches ONLY on button click (GET)
# ----------------------------
$auditContent = @'
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
            Trips loaded: <b>{trips.length}</b> · Showing: <b>{filtered.length}</b>
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
                    {t.pickup_label ? `PU: ${t.pickup_label}` : "PU: —"}{" "}
                    {t.dropoff_label ? `· DO: ${t.dropoff_label}` : "· DO: —"}
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
'@

Write-Utf8 $stuckDrivers  $stuckDriversContent
Write-Utf8 $autoAssignMon $autoAssignMonContent
Write-Utf8 $walletRecon   $walletReconContent
Write-Utf8 $auditTrail    $auditContent

Write-Host ""
Write-Host "[DONE] Phase 10C (UI-only): created missing /admin/ops pages + added /admin/audit + fixed Control Center filter."
