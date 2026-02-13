# PATCH-JRIDE_PHASE6A_VENDOR_PAYOUTS_MONTHLY_SUMMARY_READONLY_CSV.ps1
# Creates READ-ONLY admin report:
# - app/api/admin/vendor-payouts-summary/route.ts   (GET only; reads existing views/tables)
# - app/admin/vendor-payouts-summary/page.tsx      (filters + dynamic table + totals + CSV export)
#
# Uses existing objects (NO schema changes):
# - admin_vendor_payout_monthly  (known cols)
# - admin_vendor_payouts_summary (cols may vary; we do NOT assume)
#
# LOCKED:
# - NO wallet mutations
# - NO payout status updates
# - NO schema changes
# - NO Mapbox/LiveTrips edits

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = (Get-Location).Path
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Ensure-Dir($dir) {
  if (!(Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
    Ok "[OK] Created dir: $dir"
  }
}

function Backup-IfExists($path) {
  if (Test-Path -LiteralPath $path) {
    $ts = Get-Date -Format "yyyyMMdd_HHmmss"
    $bak = "$path.bak.$ts"
    Copy-Item -LiteralPath $path -Destination $bak -Force
    Ok "[OK] Backup: $bak"
  }
}

# --- Targets ---
$apiDir = Join-Path $root "app\api\admin\vendor-payouts-summary"
$uiDir  = Join-Path $root "app\admin\vendor-payouts-summary"

$apiFile = Join-Path $apiDir "route.ts"
$uiFile  = Join-Path $uiDir  "page.tsx"

Ensure-Dir $apiDir
Ensure-Dir $uiDir

Backup-IfExists $apiFile
Backup-IfExists $uiFile

# ============================================================
# 1) API: app/api/admin/vendor-payouts-summary/route.ts
#    GET /api/admin/vendor-payouts-summary?view=monthly|summary&vendor_id=...&month_start=YYYY-MM-01&limit=200
#    READ-ONLY via Supabase REST (service role); no mutations.
# ============================================================
$apiTs = @'
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error("Missing env var: " + name);
  return v;
}

function s(v: any) { return String(v ?? "").trim(); }

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const view = (url.searchParams.get("view") || "monthly").toLowerCase();
    const vendorId = s(url.searchParams.get("vendor_id"));
    const monthStart = s(url.searchParams.get("month_start")); // YYYY-MM-01 (optional)
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 500);

    const SUPABASE_URL = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SERVICE_ROLE = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    // Only allow expected sources (read-only)
    const source =
      view === "summary"
        ? "admin_vendor_payouts_summary"
        : "admin_vendor_payout_monthly";

    const qs = new URLSearchParams();
    qs.set("select", "*");
    qs.set("limit", String(limit));

    // Order (best-effort; if a column doesn't exist, Supabase REST may error.
    // We'll only set month_start order for monthly.)
    if (source === "admin_vendor_payout_monthly") {
      qs.set("order", "month_start.desc");
      if (monthStart) qs.set("month_start", "eq." + monthStart);
    }

    if (vendorId) qs.set("vendor_id", "eq." + vendorId);

    const restUrl = `${SUPABASE_URL}/rest/v1/${source}?${qs.toString()}`;

    const res = await fetch(restUrl, {
      headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE },
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, code: "DB_ERROR", message: "Failed to load " + source, details: text },
        { status: res.status }
      );
    }

    // Return raw JSON array to keep UI simple (same pattern as your payouts list APIs)
    return new NextResponse(text, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, code: "SERVER_ERROR", message: e?.message || String(e) }, { status: 500 });
  }
}
'@

[System.IO.File]::WriteAllText($apiFile, $apiTs, $utf8NoBom)
Ok "[OK] Wrote: $apiFile"

# ============================================================
# 2) UI: app/admin/vendor-payouts-summary/page.tsx
#    - Switch: monthly vs summary
#    - Month picker (monthly only) -> month_start YYYY-MM-01
#    - Vendor filter
#    - Dynamic columns (NO assumptions)
#    - Totals row: sums numeric columns (best-effort)
#    - Export CSV (client-side)
# ============================================================
$uiTsx = @'
"use client";

import { useEffect, useMemo, useState } from "react";

type AnyRow = Record<string, any>;
type Banner = { kind: "ok" | "warn" | "err"; text: string } | null;

function normalizeErr(e: any): string {
  const raw = (e?.message || e?.error || String(e || "")).trim();
  if (!raw) return "Request failed.";
  if (raw.length > 300) return raw.slice(0, 300) + "...";
  return raw;
}

function toMonthStart(monthValue: string): string {
  // monthValue is "YYYY-MM" from <input type="month">
  const m = String(monthValue || "").trim();
  if (!m || m.length < 7) return "";
  return m + "-01";
}

function fmtMoney(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "");
  return n.toFixed(2);
}

function isNumericValue(v: any): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string" && v.trim() !== "") return Number.isFinite(Number(v));
  return false;
}

function csvEscape(v: any): string {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export default function AdminVendorPayoutsSummaryPage() {
  const [view, setView] = useState<"monthly" | "summary">("monthly");
  const [month, setMonth] = useState<string>(""); // YYYY-MM (for input type month)
  const [vendorId, setVendorId] = useState<string>("");

  const [rows, setRows] = useState<AnyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  // restore filters
  useEffect(() => {
    try {
      const v = localStorage.getItem("vendor_payouts_summary_view");
      const m = localStorage.getItem("vendor_payouts_summary_month");
      const vid = localStorage.getItem("vendor_payouts_summary_vendor");
      if (v === "monthly" || v === "summary") setView(v);
      if (m) setMonth(m);
      if (vid) setVendorId(vid);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("vendor_payouts_summary_view", view);
      localStorage.setItem("vendor_payouts_summary_month", month || "");
      localStorage.setItem("vendor_payouts_summary_vendor", vendorId || "");
    } catch {}
  }, [view, month, vendorId]);

  async function load() {
    setLoading(true);
    setBanner(null);
    try {
      const qs = new URLSearchParams();
      qs.set("view", view);
      qs.set("limit", "500");
      if (vendorId.trim()) qs.set("vendor_id", vendorId.trim());
      if (view === "monthly") {
        const ms = toMonthStart(month);
        if (ms) qs.set("month_start", ms);
      }

      const res = await fetch(`/api/admin/vendor-payouts-summary?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const msg = data?.message || data?.error || data?.details || "Failed to load report";
        throw new Error(String(msg));
      }

      setRows(Array.isArray(data) ? data : []);
      setBanner({ kind: "ok", text: `Loaded ${Array.isArray(data) ? data.length : 0} row(s).` });
    } catch (e: any) {
      setRows([]);
      setBanner({ kind: "err", text: normalizeErr(e) });
    } finally {
      setLoading(false);
    }
  }

  // auto-load once
  useEffect(() => { load(); }, []);

  const columns = useMemo(() => {
    if (!rows.length) return [] as string[];
    // stable column order: known monthly first, then the rest
    const first = rows[0] || {};
    const keys = Object.keys(first);

    const preferred = view === "monthly"
      ? ["vendor_id", "month_start", "total_billings", "total_platform_fees", "total_vendor_earnings", "total_payouts"]
      : ["vendor_id"];

    const out: string[] = [];
    for (const p of preferred) if (keys.includes(p)) out.push(p);
    for (const k of keys) if (!out.includes(k)) out.push(k);
    return out;
  }, [rows, view]);

  const totals = useMemo(() => {
    // sum numeric columns best-effort
    const t: Record<string, number> = {};
    for (const c of columns) t[c] = 0;

    for (const r of rows) {
      for (const c of columns) {
        const v = r?.[c];
        if (isNumericValue(v)) t[c] += Number(v);
      }
    }
    return t;
  }, [rows, columns]);

  function downloadCsv() {
    try {
      if (!columns.length) {
        setBanner({ kind: "warn", text: "No rows to export." });
        return;
      }

      const lines: string[] = [];
      lines.push(columns.map(csvEscape).join(","));

      for (const r of rows) {
        const vals = columns.map((c) => csvEscape(r?.[c]));
        lines.push(vals.join(","));
      }

      // totals row (optional): only show if at least one numeric column exists
      const anyNum = columns.some((c) => Number.isFinite(totals[c]) && totals[c] !== 0);
      if (anyNum) {
        const totRow = columns.map((c) => {
          if (isNumericValue(totals[c])) return csvEscape(totals[c].toFixed(2));
          return csvEscape(c === columns[0] ? "TOTAL" : "");
        });
        lines.push(totRow.join(","));
      }

      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });

      const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "").replace("T", "_");
      const file = `vendor_payouts_${view}_${stamp}.csv`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setBanner({ kind: "ok", text: "CSV downloaded: " + file });
    } catch (e: any) {
      setBanner({ kind: "err", text: normalizeErr(e) });
    }
  }

  const btn: any = {
    padding: "6px 10px",
    border: "1px solid #ddd",
    borderRadius: 8,
    background: "white",
    cursor: "pointer",
    fontSize: 12,
  };
  const btnDisabled: any = { ...btn, opacity: 0.5, cursor: "not-allowed" };

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
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Vendor Payouts Report (Read-only)</h1>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <label>
          View:&nbsp;
          <select value={view} onChange={(e) => setView(e.target.value as any)}>
            <option value="monthly">monthly</option>
            <option value="summary">summary</option>
          </select>
        </label>

        <label style={{ opacity: view === "monthly" ? 1 : 0.5 }}>
          Month:&nbsp;
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            disabled={view !== "monthly"}
          />
        </label>

        <label>
          Vendor ID:&nbsp;
          <input
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            placeholder="optional vendor UUID"
            style={{ width: 310 }}
          />
        </label>

        <button style={loading ? btnDisabled : btn} disabled={loading} onClick={load}>Refresh</button>
        <button style={(!rows.length || loading) ? btnDisabled : btn} disabled={!rows.length || loading} onClick={downloadCsv}>Export CSV</button>

        {loading ? <span style={{ opacity: 0.7 }}>Loading...</span> : null}
      </div>

      {banner ? <div style={bannerStyle(banner.kind)}>{banner.text}</div> : null}

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((r, idx) => (
              <tr key={String(r?.id ?? "") + ":" + idx}>
                {columns.map((c) => {
                  const v = r?.[c];
                  const showMoney = typeof v === "number" && (c.startsWith("total_") || c.endsWith("_fees") || c.endsWith("_earnings") toggle);
                  // keep simple: format numbers with 2 decimals; otherwise raw
                  const txt = (typeof v === "number") ? fmtMoney(v) : String(v ?? "");
                  return (
                    <td key={c} style={{ padding: 8, borderBottom: "1px solid #eee", fontFamily: c.endsWith("_id") ? "monospace" : "inherit" }}>
                      {txt}
                    </td>
                  );
                })}
              </tr>
            ))}

            {rows.length === 0 ? (
              <tr><td colSpan={Math.max(columns.length, 1)} style={{ padding: 12, color: "#666" }}>No rows.</td></tr>
            ) : null}

            {rows.length > 0 ? (
              <tr>
                {columns.map((c, i) => {
                  const sum = totals[c];
                  const show = Number.isFinite(sum) && sum !== 0 && columns.some((cc) => isNumericValue(rows[0]?.[cc]));
                  const label = i === 0 ? "TOTAL" : "";
                  const txt = show ? sum.toFixed(2) : label;
                  return (
                    <td key={"tot:" + c} style={{ padding: 8, borderTop: "2px solid #ddd", fontWeight: 700 }}>
                      {txt}
                    </td>
                  );
                })}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
        Locked rule: this page is read-only and does not change any payouts or wallets.
      </div>
    </div>
  );
}
'@

# NOTE: There is a tiny accidental token "toggle" in the above TypeScript line if copied incorrectly.
# We'll remove any stray "toggle" safely before writing.
$uiTsx = $uiTsx -replace "\s+toggle\);\s*", ");`r`n"

[System.IO.File]::WriteAllText($uiFile, $uiTsx, $utf8NoBom)
Ok "[OK] Wrote: $uiFile"

Ok "[DONE] Phase 6A files created (read-only report + CSV export)."
