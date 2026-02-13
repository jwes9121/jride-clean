$ErrorActionPreference = "Stop"

function Timestamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
$ts = Timestamp

function Ensure-Dir($p) { if (!(Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null } }

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

$root = (Get-Location).Path
$controlCenter = Join-Path $root "app\admin\control-center\page.tsx"
$financePage   = Join-Path $root "app\admin\finance\summary\page.tsx"

if (!(Test-Path $controlCenter)) { Fail "Missing file: $controlCenter" }

Backup-IfExists $controlCenter
Backup-IfExists $financePage

$cc = Get-Content -Raw -Path $controlCenter

# ---------------------------------------------------------------------
# 1) Fix C2 B7 mojibake prefix using CHAR CODES (no broken literals)
#    Replace U+00C2 U+00B7 with U+00B7
# ---------------------------------------------------------------------
$bad  = ([string]([char]0x00C2) + [char]0x00B7)
$good = ([string]([char]0x00B7))
if ($cc.Contains($bad)) {
  $cc = $cc.Replace($bad, $good)
  Write-Host "[OK] Removed mojibake sequence via char codes (C2 B7 -> B7)."
} else {
  Write-Host "[OK] No C2 B7 mojibake sequence found."
}

# ---------------------------------------------------------------------
# 2) Insert Financial Summary item before Wallet Reconciliation (anchor-based)
#    No dependency on section heading text.
# ---------------------------------------------------------------------
if ($cc -match 'href\s*:\s*["'']\/admin\/finance\/summary["'']') {
  Write-Host "[OK] Financial Summary link already present; skipping insert."
} else {

  $financeItem = @'
          {
            title: "Financial Summary (Read-only)",
            desc: "Snapshot-based totals and quick export (no wallet mutations).",
            href: "/admin/finance/summary",
          },
'@

  # Match a full Wallet Reconciliation item object block (best-effort, non-greedy)
  $walletPattern = '(?s)(\{\s*title\s*:\s*"Wallet Reconciliation"\s*,.*?href\s*:\s*["'']\/admin\/ops\/wallet-reconciliation["'']\s*,\s*\}\s*,?)'
  if ([regex]::IsMatch($cc, $walletPattern)) {
    $cc = [regex]::Replace($cc, $walletPattern, ($financeItem + '$1'), 1)
    Write-Host "[OK] Inserted Financial Summary before Wallet Reconciliation."
  } else {
    # Fallback: match Wallet Reconciliation title only (href might differ)
    $walletPattern2 = '(?s)(\{\s*title\s*:\s*"Wallet Reconciliation"\s*,.*?\}\s*,?)'
    if ([regex]::IsMatch($cc, $walletPattern2)) {
      $cc = [regex]::Replace($cc, $walletPattern2, ($financeItem + '$1'), 1)
      Write-Host "[OK] Inserted Financial Summary before Wallet Reconciliation (fallback match)."
    } else {
      Fail "Could not locate Wallet Reconciliation item to anchor insertion. Paste app/admin/control-center/page.tsx so we can patch deterministically."
    }
  }
}

Write-Utf8NoBom $controlCenter $cc

# ---------------------------------------------------------------------
# 3) Create /admin/finance/summary page (READ-ONLY, click-to-load GET only)
#    Data source: GET /api/admin/livetrips/page-data
#    - Best-effort sums candidate numeric fields (no schema assumptions)
#    - Client-side CSV export of derived rows
# ---------------------------------------------------------------------
$financeContent = @'
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

function toNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

function pickFirstNumber(obj: AnyObj, keys: string[]): number | null {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
      const n = toNum(obj[k]);
      if (n !== null) return n;
    }
  }
  return null;
}

function downloadCsv(filename: string, rows: AnyObj[]) {
  const headers = Array.from(
    rows.reduce((set, r) => {
      Object.keys(r || {}).forEach((k) => set.add(k));
      return set;
    }, new Set<string>())
  );

  const esc = (v: any) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines: string[] = [];
  lines.push(headers.map(esc).join(","));
  for (const r of rows) lines.push(headers.map((h) => esc((r as AnyObj)[h])).join(","));

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export default function FinancialSummaryPage() {
  const [raw, setRaw] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      setErr(String(e?.message || e || "Failed to load"));
    } finally {
      setLoading(false);
    }
  }

  const trips = useMemo(() => parseTrips(raw), [raw]);

  const computed = useMemo(() => {
    const totalKeys = ["total", "total_amount", "grand_total", "amount", "fare", "total_fare", "price_total", "bill_total"];
    const platformKeys = ["platform_fee", "company_cut", "commission", "service_fee", "app_fee", "fee_amount"];
    const driverKeys = ["driver_payout", "driver_amount", "driver_share", "net_driver", "driver_net"];
    const vendorKeys = ["vendor_total", "vendor_amount", "vendor_net", "net_vendor"];

    let gross = 0, platformFee = 0, driverPayout = 0, vendorTotal = 0;
    let grossCount = 0, platformCount = 0, driverCount = 0, vendorCount = 0;

    const counts: Record<string, number> = {
      requested: 0, assigned: 0, on_the_way: 0, arrived: 0, enroute: 0, on_trip: 0, completed: 0, cancelled: 0, other: 0,
    };

    for (const t of trips) {
      const st = norm(t.status);
      if (Object.prototype.hasOwnProperty.call(counts, st)) counts[st] += 1;
      else counts.other += 1;

      const g = pickFirstNumber(t, totalKeys);
      if (g !== null) { gross += g; grossCount++; }

      const pf = pickFirstNumber(t, platformKeys);
      if (pf !== null) { platformFee += pf; platformCount++; }

      const dp = pickFirstNumber(t, driverKeys);
      if (dp !== null) { driverPayout += dp; driverCount++; }

      const vt = pickFirstNumber(t, vendorKeys);
      if (vt !== null) { vendorTotal += vt; vendorCount++; }
    }

    const active = counts.assigned + counts.on_the_way + counts.arrived + counts.enroute + counts.on_trip;

    const rows = [
      { metric: "Trips (total)", value: trips.length, note: "Snapshot rows loaded" },
      { metric: "Trips (completed)", value: counts.completed, note: "" },
      { metric: "Trips (active)", value: active, note: "assigned/on_the_way/arrived/enroute/on_trip" },
      { metric: "Trips (requested)", value: counts.requested, note: "" },
      { metric: "Trips (cancelled)", value: counts.cancelled, note: "" },

      { metric: "Gross Total (best-effort)", value: gross, note: grossCount ? `Derived from ${grossCount} rows using keys: ${totalKeys.join(", ")}` : "No numeric total fields found in snapshot rows" },
      { metric: "Platform Fee (best-effort)", value: platformFee, note: platformCount ? `Derived from ${platformCount} rows using keys: ${platformKeys.join(", ")}` : "No platform fee fields found" },
      { metric: "Driver Payout (best-effort)", value: driverPayout, note: driverCount ? `Derived from ${driverCount} rows using keys: ${driverKeys.join(", ")}` : "No driver payout fields found" },
      { metric: "Vendor Total (best-effort)", value: vendorTotal, note: vendorCount ? `Derived from ${vendorCount} rows using keys: ${vendorKeys.join(", ")}` : "No vendor total fields found" },
    ];

    return { rows };
  }, [trips]);

  const card: any = { border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, background: "white" };
  const btn: any = { display: "inline-block", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 10, background: "white", fontSize: 13, textDecoration: "none", cursor: "pointer" };
  const btnDisabled: any = { ...btn, opacity: 0.55, cursor: "not-allowed" };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Financial Summary (Read-only)</h1>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
        Snapshot-based totals derived from existing LiveTrips page-data. GET-only on click. No wallet mutations.
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={loading ? btnDisabled : btn} onClick={loadSnapshot} disabled={loading}>
          {loading ? "Loading snapshot..." : "Load snapshot (GET)"}
        </button>

        <button
          type="button"
          style={!raw ? btnDisabled : btn}
          disabled={!raw}
          onClick={() => downloadCsv(`financial_summary_${new Date().toISOString().slice(0, 10)}.csv`, computed.rows)}
        >
          Export CSV (derived)
        </button>

        <Link href="/admin/control-center" style={btn}>Back to Control Center</Link>
        <Link href="/admin/reports/lgu" style={btn}>Open LGU Exports</Link>
        <Link href="/admin/ops/health" style={btn}>Open Ops Health</Link>
      </div>

      {err ? (
        <div style={{ ...card, marginTop: 12, borderColor: "#fecaca", background: "#fff1f2" }}>
          <div style={{ fontWeight: 800 }}>Error</div>
          <div style={{ marginTop: 6, opacity: 0.9 }}>{err}</div>
        </div>
      ) : null}

      <div style={{ marginTop: 14, ...card }}>
        <div style={{ fontWeight: 800 }}>Summary</div>

        {!raw ? (
          <div style={{ marginTop: 10, opacity: 0.7, fontSize: 13 }}>
            No snapshot loaded yet. Click <b>Load snapshot (GET)</b>.
          </div>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            {computed.rows.map((r, idx) => (
              <div key={idx} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "white" }}>
                <div style={{ fontWeight: 800 }}>{r.metric}</div>
                <div style={{ marginTop: 6, fontSize: 26, fontWeight: 900 }}>{String(r.value)}</div>
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>{r.note}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 14, fontSize: 12, opacity: 0.7 }}>
        Locked rule: read-only UI. GET-only on click. No wallet mutations. No Mapbox changes. No LiveTrips logic changes.
      </div>
    </div>
  );
}
'@

Write-Utf8NoBom $financePage $financeContent

Write-Host ""
Write-Host "[DONE] PHASE13: Financial Summary page created + Control Center link inserted (anchored to Wallet Reconciliation)."
