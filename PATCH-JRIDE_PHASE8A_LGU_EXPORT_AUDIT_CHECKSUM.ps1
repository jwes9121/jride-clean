# PATCH-JRIDE_PHASE8A_LGU_EXPORT_AUDIT_CHECKSUM.ps1
# Phase 8A: LGU Export Hardening (READ-ONLY)
# - Standardized filenames
# - Export metadata summary
# - SHA-256 checksum + copy
# - UI-only audit (no backend writes)
# - NO schema / wallet / payout mutations

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\reports\lgu\page.tsx"

if (!(Test-Path $target)) {
  Fail "Target file not found: $target"
}

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "[OK] Backup created: $bak"

# New content (FULL replacement)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$code = @'
"use client";

import { useEffect, useMemo, useState } from "react";

type AnyRow = Record<string, any>;
type Banner = { kind: "ok" | "warn" | "err"; text: string } | null;

function sha256Hex(buf: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest("SHA-256", buf).then(hash => {
    const bytes = Array.from(new Uint8Array(hash));
    return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
  });
}

function normalizeErr(e: any): string {
  const raw = (e?.message || e?.error || String(e || "")).trim();
  if (!raw) return "Request failed.";
  if (raw.length > 320) return raw.slice(0, 320) + "...";
  return raw;
}

function toMonthStart(m: string): string {
  if (!m || m.length < 7) return "";
  return m + "-01";
}

function isNum(v: any): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") return v.trim() !== "" && Number.isFinite(Number(v));
  return false;
}

function fmt(v: any) {
  return isNum(v) ? Number(v).toFixed(2) : String(v ?? "");
}

function csvEscape(v: any): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

export default function LguReportsPage() {
  const [tab, setTab] = useState<"vendor" | "driver">("vendor");
  const [vendorView, setVendorView] = useState<"monthly" | "summary">("monthly");
  const [vendorMonth, setVendorMonth] = useState("");
  const [vendorId, setVendorId] = useState("");

  const [driverView, setDriverView] = useState<"daily" | "requests">("daily");
  const [driverId, setDriverId] = useState("");

  const [rows, setRows] = useState<AnyRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const [exportInfo, setExportInfo] = useState<any>(null);
  const [checksum, setChecksum] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setBanner(null);
    setExportInfo(null);
    setChecksum(null);

    try {
      let url = "";
      if (tab === "vendor") {
        const qs = new URLSearchParams();
        qs.set("view", vendorView);
        qs.set("limit", "500");
        if (vendorId) qs.set("vendor_id", vendorId);
        if (vendorView === "monthly") {
          const ms = toMonthStart(vendorMonth);
          if (ms) qs.set("month_start", ms);
        }
        url = "/api/admin/reports/lgu-vendor?" + qs.toString();
      } else {
        const qs = new URLSearchParams();
        qs.set("view", driverView);
        qs.set("limit", "500");
        if (driverView === "requests" && driverId) qs.set("driver_id", driverId);
        url = "/api/admin/reports/lgu-driver?" + qs.toString();
      }

      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Load failed");

      setRows(Array.isArray(data) ? data : []);
      setBanner({ kind: "ok", text: `Loaded ${data.length} row(s).` });
    } catch (e:any) {
      setRows([]);
      setBanner({ kind: "err", text: normalizeErr(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!query) return rows;
    const q = query.toLowerCase();
    return rows.filter(r => JSON.stringify(r).toLowerCase().includes(q));
  }, [rows, query]);

  const columns = useMemo(() => {
    if (!filtered.length) return [];
    return Object.keys(filtered[0]);
  }, [filtered]);

  async function exportCsv() {
    if (!filtered.length) return;

    const now = new Date();
    const stamp = now.toISOString().replace(/[:T]/g,"").slice(0,15);

    const base =
      tab === "vendor"
        ? `LGU_VENDOR_${vendorView.toUpperCase()}`
        : `LGU_DRIVER_${driverView.toUpperCase()}`;

    const file =
      tab === "vendor" && vendorView === "monthly" && vendorMonth
        ? `${base}_${vendorMonth}_${stamp}.csv`
        : `${base}_${stamp}.csv`;

    const lines = [
      columns.join(","),
      ...filtered.map(r => columns.map(c => csvEscape(r[c])).join(","))
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const buf = await blob.arrayBuffer();
    const hash = await sha256Hex(buf);

    setChecksum(hash);
    setExportInfo({
      file,
      rows: filtered.length,
      time: now.toISOString(),
      view: tab === "vendor" ? vendorView : driverView,
      vendor_id: vendorId || null,
      driver_id: driverId || null
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file;
    a.click();
    URL.revokeObjectURL(url);

    setBanner({ kind: "ok", text: `Exported ${file}` });
  }

  return (
    <div style={{ padding: 16 }}>
      <h1>LGU / Accounting Exports (Read-only)</h1>

      <div style={{ marginBottom: 12 }}>
        <button onClick={()=>setTab("vendor")}>Vendor</button>{" "}
        <button onClick={()=>setTab("driver")}>Driver</button>
      </div>

      <button disabled={loading} onClick={load}>Refresh</button>{" "}
      <button disabled={!filtered.length} onClick={exportCsv}>Export CSV</button>

      {banner && <div style={{ marginTop: 10 }}>{banner.text}</div>}

      {exportInfo && (
        <div style={{ marginTop: 12, padding: 10, border: "1px solid #ddd" }}>
          <b>Export Summary</b>
          <pre>{JSON.stringify(exportInfo, null, 2)}</pre>
          <b>SHA-256</b>
          <div style={{ display: "flex", gap: 8 }}>
            <code>{checksum}</code>
            <button onClick={()=>navigator.clipboard.writeText(checksum||"")}>Copy</button>
          </div>
        </div>
      )}

      <table border={1} cellPadding={6} style={{ marginTop: 12 }}>
        <thead>
          <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {filtered.map((r,i)=>(
            <tr key={i}>{columns.map(c=><td key={c}>{fmt(r[c])}</td>)}</tr>
          ))}
        </tbody>
      </table>

      <p style={{ marginTop: 10, opacity: 0.6 }}>
        Locked rule: read-only exports. No wallet mutations. No payout updates.
      </p>
    </div>
  );
}
'@

[System.IO.File]::WriteAllText($target, $code, $utf8NoBom)
Ok "[DONE] Phase 8A applied successfully"
