# PATCH-JRIDE_WALLET_RECONCILIATION_PAGE_V1.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
Info "Repo root: $root"

function Ensure-Dir([string]$dir){
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null; Ok "Created dir: $dir" }
}

function Backup-IfExists([string]$path){
  if (Test-Path $path) {
    Copy-Item -Force $path "$path.bak.$(Stamp)"
    Ok "Backup: $path.bak.$(Stamp)"
  }
}

function Write-Utf8([string]$path, [string]$content){
  Ensure-Dir (Split-Path -Parent $path)
  Set-Content -Path $path -Value $content -Encoding UTF8
  Ok "Wrote: $path"
}

# -----------------------------
# API: /api/admin/ops/wallet-reconciliation
# -----------------------------
$apiPath = Join-Path $root "app\api\admin\ops\wallet-reconciliation\route.ts"
Backup-IfExists $apiPath

$api = @'
import { NextResponse } from "next/server";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function envFirst(...keys: string[]) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim().length > 0) return String(v).trim();
  }
  return "";
}

function requireAdminKey(req: Request) {
  const need = envFirst("ADMIN_API_KEY");
  if (!need) return { ok: true };
  const got = req.headers.get("x-admin-key") || "";
  if (got !== need) return { ok: false };
  return { ok: true };
}

async function restGet(url: string, key: string) {
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

export async function GET(req: Request) {
  try {
    const gate = requireAdminKey(req);
    if (!gate.ok) return json(401, { ok: false, code: "UNAUTHORIZED" });

    const SUPABASE_URL = envFirst("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
    const SERVICE_KEY = envFirst(
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_KEY",
      "SUPABASE_SERVICE_ROLE",
      "SUPABASE_SERVICE_ROLE_SECRET"
    );
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, code: "ENV_MISSING" });

    const { searchParams } = new URL(req.url);
    const limit = Math.max(10, Math.min(500, Number(searchParams.get("limit") || 120)));
    const threshold = Math.max(0, Number(searchParams.get("threshold") || 0.01)); // drift tolerance

    // Drivers: compare drivers.wallet_balance vs SUM(driver_wallet_transactions.amount)
    const drvUrl = `${SUPABASE_URL}/rest/v1/drivers?select=id,full_name,wallet_balance&order=updated_at.desc&limit=${limit}`;
    const drv = await restGet(drvUrl, SERVICE_KEY);
    if (!drv.ok) return json(502, { ok: false, code: "REST_FAILED", stage: "drivers", status: drv.status, data: drv.data });

    // Pull recent tx sums per driver (best-effort: do a broad query and sum in JS)
    const dtxUrl = `${SUPABASE_URL}/rest/v1/driver_wallet_transactions?select=driver_id,amount&limit=5000`;
    const dtx = await restGet(dtxUrl, SERVICE_KEY);
    const dSums: Record<string, number> = {};
    if (dtx.ok && Array.isArray(dtx.data)) {
      for (const r of dtx.data) {
        const id = String((r as any).driver_id || "");
        const amt = Number((r as any).amount || 0);
        if (!id) continue;
        dSums[id] = (dSums[id] || 0) + amt;
      }
    }

    const driverDrift = (drv.data || []).map((d: any) => {
      const id = String(d.id);
      const bal = Number(d.wallet_balance || 0);
      const sum = Number(dSums[id] || 0);
      const drift = bal - sum;
      return { driver_id: id, full_name: d.full_name || null, wallet_balance: bal, tx_sum: sum, drift };
    }).filter((r: any) => Math.abs(r.drift) > threshold);

    // Vendors: compare vendor_wallet.balance vs SUM(vendor_wallet_transactions.amount)
    const vwUrl = `${SUPABASE_URL}/rest/v1/vendor_wallet?select=vendor_id,balance&limit=${limit}`;
    const vw = await restGet(vwUrl, SERVICE_KEY);

    const vtxUrl = `${SUPABASE_URL}/rest/v1/vendor_wallet_transactions?select=vendor_id,amount&limit=5000`;
    const vtx = await restGet(vtxUrl, SERVICE_KEY);
    const vSums: Record<string, number> = {};
    if (vtx.ok && Array.isArray(vtx.data)) {
      for (const r of vtx.data) {
        const id = String((r as any).vendor_id || "");
        const amt = Number((r as any).amount || 0);
        if (!id) continue;
        vSums[id] = (vSums[id] || 0) + amt;
      }
    }

    const vendorDrift = (vw.data || []).map((v: any) => {
      const id = String(v.vendor_id);
      const bal = Number(v.balance || 0);
      const sum = Number(vSums[id] || 0);
      const drift = bal - sum;
      return { vendor_id: id, wallet_balance: bal, tx_sum: sum, drift };
    }).filter((r: any) => Math.abs(r.drift) > threshold);

    return json(200, {
      ok: true,
      params: { limit, threshold },
      driver_drift: driverDrift,
      vendor_drift: vendorDrift,
      notes: [
        "This is a read-only drift detector.",
        "If tx limits are too low for your data size, we can switch to SQL views for exact sums.",
      ],
    });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: e?.message || String(e) });
  }
}
'@

Write-Utf8 $apiPath $api

# -----------------------------
# UI page: /admin/ops/wallet-reconciliation
# -----------------------------
$pagePath = Join-Path $root "app\admin\ops\wallet-reconciliation\page.tsx"
Backup-IfExists $pagePath

$page = @'
"use client";

import React, { useMemo, useState } from "react";

function n(x: any) { const v = Number(x); return Number.isFinite(v) ? v : 0; }

export default function WalletReconciliationPage() {
  const [adminKey, setAdminKey] = useState("");
  const [limit, setLimit] = useState(120);
  const [threshold, setThreshold] = useState(0.01);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<any>(null);

  async function run() {
    setBusy(true);
    setOut(null);
    try {
      const headers: Record<string, string> = {};
      if (adminKey.trim()) headers["x-admin-key"] = adminKey.trim();
      const res = await fetch(`/api/admin/ops/wallet-reconciliation?limit=${limit}&threshold=${threshold}`, { headers });
      const data = await res.json();
      setOut(data);
    } catch (e: any) {
      setOut({ ok: false, error: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  const driverRows = useMemo(() => (out?.driver_drift || []) as any[], [out]);
  const vendorRows = useMemo(() => (out?.vendor_drift || []) as any[], [out]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xl font-bold">Wallet Reconciliation</div>
          <div className="text-sm text-slate-500">Detects drift between wallet balances and transaction sums (read-only).</div>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="Admin key (optional)"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm"
          />
          <input
            value={limit}
            onChange={(e) => setLimit(n(e.target.value))}
            type="number"
            min={10}
            max={500}
            className="w-24 rounded-xl border border-black/10 px-3 py-2 text-sm"
          />
          <input
            value={threshold}
            onChange={(e) => setThreshold(n(e.target.value))}
            type="number"
            step="0.01"
            min={0}
            className="w-28 rounded-xl border border-black/10 px-3 py-2 text-sm"
          />
          <button
            onClick={run}
            disabled={busy}
            className="rounded-xl bg-black text-white px-4 py-2 text-sm disabled:opacity-50"
          >
            {busy ? "Checking..." : "Run Check"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-black/10 p-4">
          <div className="font-semibold mb-2">Drivers drift</div>
          {driverRows.length === 0 ? (
            <div className="text-sm text-slate-500">(none)</div>
          ) : (
            <div className="space-y-2">
              {driverRows.map((r, i) => (
                <div key={i} className="rounded-xl border border-black/10 p-3 text-sm">
                  <div className="font-semibold">{r.full_name || r.driver_id}</div>
                  <div className="text-xs text-slate-500">{r.driver_id}</div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <div><div className="text-xs text-slate-500">wallet</div><div className="font-mono">{n(r.wallet_balance).toFixed(2)}</div></div>
                    <div><div className="text-xs text-slate-500">tx sum</div><div className="font-mono">{n(r.tx_sum).toFixed(2)}</div></div>
                    <div><div className="text-xs text-slate-500">drift</div><div className="font-mono">{n(r.drift).toFixed(2)}</div></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-black/10 p-4">
          <div className="font-semibold mb-2">Vendors drift</div>
          {vendorRows.length === 0 ? (
            <div className="text-sm text-slate-500">(none)</div>
          ) : (
            <div className="space-y-2">
              {vendorRows.map((r, i) => (
                <div key={i} className="rounded-xl border border-black/10 p-3 text-sm">
                  <div className="font-semibold">{r.vendor_id}</div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <div><div className="text-xs text-slate-500">wallet</div><div className="font-mono">{n(r.wallet_balance).toFixed(2)}</div></div>
                    <div><div className="text-xs text-slate-500">tx sum</div><div className="font-mono">{n(r.tx_sum).toFixed(2)}</div></div>
                    <div><div className="text-xs text-slate-500">drift</div><div className="font-mono">{n(r.drift).toFixed(2)}</div></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-black/10 p-4">
        <div className="font-semibold mb-2">Raw output</div>
        <pre className="text-xs whitespace-pre-wrap max-h-80 overflow-auto">{out ? JSON.stringify(out, null, 2) : "(no output yet)"}</pre>
      </div>
    </div>
  );
}
'@

Write-Utf8 $pagePath $page

Ok "DONE."
Ok "Open: /admin/ops/wallet-reconciliation"
Ok "API:  /api/admin/ops/wallet-reconciliation"
