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

function Write-Utf8NoBom($path, $content) {
  Ensure-Dir (Split-Path -Parent $path)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
  Write-Host "[OK] Wrote: $path"
}

function Fail($m) { throw $m }

# ----------------------------
# Paths
# ----------------------------
$root = (Get-Location).Path
$controlCenter = Join-Path $root "app\admin\control-center\page.tsx"
$opsHealth     = Join-Path $root "app\admin\ops\health\page.tsx"

if (!(Test-Path $controlCenter)) { Fail "Missing file: $controlCenter" }

Backup-IfExists $controlCenter
Backup-IfExists $opsHealth

$cc = Get-Content -Raw -Path $controlCenter

# If already present, skip modifications
$hasOpsItem = ($cc -match [regex]::Escape('/admin/ops/health'))
$hasOpsHrefQuoted = ($cc -match 'href:\s*["'']\/admin\/ops\/health["'']')

# ----------------------------
# 1) Insert Ops Health item into sections list (Quality / Operations items)
#    Flexible strategy: insert near known href anchors.
# ----------------------------
if (-not $hasOpsItem -and -not $hasOpsHrefQuoted) {

  $opsItemBlock = @'
          {
            title: "Ops Health Dashboard",
            desc: "High-level operational health indicators (read-only).",
            href: "/admin/ops/health",
          },
'@

  # Try to insert after the Auto-Assign Monitor item block inside sections
  # Look for: href: "/admin/ops/auto-assign-monitor", ... },  then insert right after that object
  $afterAutoAssign = '(?s)(\{\s*title\s*:\s*"Auto-Assign Monitor".*?href\s*:\s*["'']\/admin\/ops\/auto-assign-monitor["'']\s*,\s*\}\s*,\s*)'
  if ([regex]::IsMatch($cc, $afterAutoAssign)) {
    $cc = [regex]::Replace($cc, $afterAutoAssign, ('$1' + $opsItemBlock), 1)
    Write-Host "[OK] Inserted Ops Health after Auto-Assign Monitor item."
  } else {
    # Try to insert before Audit Trail item block (still within same section)
    $beforeAudit = '(?s)(\{\s*title\s*:\s*"Audit Trail \(Read-only\)".*?href\s*:\s*["'']\/admin\/audit["'']\s*,\s*\}\s*,?\s*)'
    if ([regex]::IsMatch($cc, $beforeAudit)) {
      $cc = [regex]::Replace($cc, $beforeAudit, ($opsItemBlock + '$1'), 1)
      Write-Host "[OK] Inserted Ops Health before Audit Trail item."
    } else {
      # Last resort: append into the Quality / Operations items array by locating that section heading and its items array brackets.
      $patternQO = '(?s)(heading\s*:\s*"Quality\s*/\s*Operations"\s*,\s*items\s*:\s*\[)(.*?)(\]\s*\}\s*,?)'
      $m = [regex]::Match($cc, $patternQO)
      if (-not $m.Success) {
        Fail "Could not locate Quality / Operations section OR known anchors. Paste app/admin/control-center/page.tsx (current) so we can patch deterministically."
      }

      $prefix = $m.Groups[1].Value
      $items  = $m.Groups[2].Value
      $suffix = $m.Groups[3].Value

      $items = $items.TrimEnd() + "`r`n" + $opsItemBlock
      $newSection = $prefix + $items + $suffix

      $cc = [regex]::Replace($cc, $patternQO, [System.Text.RegularExpressions.MatchEvaluator]{ param($mm) $newSection }, 1)
      Write-Host "[OK] Appended Ops Health into Quality / Operations items list."
    }
  }
} else {
  Write-Host "[OK] Ops Health already present in Control Center. Skipping item insert."
}

# ----------------------------
# 2) Add /admin/ops/health to dispatcherAllow list (if missing)
#    Flexible insertion near known href anchors.
# ----------------------------
if ($cc -notmatch [regex]::Escape('"/admin/ops/health"')) {

  $patternAllow = '(?s)(const\s+dispatcherAllow\s*=\s*useMemo\(\s*\(\)\s*=>\s*new\s+Set<string>\(\s*\[\s*)(.*?)(\s*\]\s*\)\s*,\s*\[\s*\]\s*\)\s*;)'
  $m2 = [regex]::Match($cc, $patternAllow)

  if (-not $m2.Success) {
    Fail "Could not locate dispatcherAllow Set<string>([ ... ]) block. Paste app/admin/control-center/page.tsx (current) so we can patch deterministically."
  }

  $pre  = $m2.Groups[1].Value
  $list = $m2.Groups[2].Value
  $post = $m2.Groups[3].Value

  if ($list -match [regex]::Escape('"/admin/ops/health"')) {
    Write-Host "[OK] /admin/ops/health already in dispatcherAllow."
  } else {
    if ($list -match '"/admin/ops/auto-assign-monitor"\s*,') {
      $list = [regex]::Replace(
        $list,
        '"/admin/ops/auto-assign-monitor"\s*,',
        ('"/admin/ops/auto-assign-monitor",' + "`r`n" + '        "/admin/ops/health",'),
        1
      )
      Write-Host "[OK] Inserted /admin/ops/health into dispatcherAllow after auto-assign."
    } elseif ($list -match '"/admin/audit"\s*,') {
      $list = [regex]::Replace(
        $list,
        '"/admin/audit"\s*,',
        ('"/admin/ops/health",' + "`r`n" + '        "/admin/audit",'),
        1
      )
      Write-Host "[OK] Inserted /admin/ops/health into dispatcherAllow before audit."
    } else {
      $list = $list.TrimEnd() + "`r`n" + '        "/admin/ops/health",'
      Write-Host "[OK] Appended /admin/ops/health into dispatcherAllow."
    }
  }

  $newAllow = $pre + $list + $post
  $cc = [regex]::Replace($cc, $patternAllow, [System.Text.RegularExpressions.MatchEvaluator]{ param($mm) $newAllow }, 1)
} else {
  Write-Host "[OK] dispatcherAllow already references /admin/ops/health. Skipping allowlist insert."
}

Write-Utf8NoBom $controlCenter $cc

# ----------------------------
# 3) Create Ops Health page (READ-ONLY, click-to-load GET only)
# ----------------------------
$opsHealthContent = @'
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
'@

Write-Utf8NoBom $opsHealth $opsHealthContent

Write-Host ""
Write-Host "[DONE] PHASE11B: /admin/ops/health created + Control Center updated (item + dispatcher allowlist)."
