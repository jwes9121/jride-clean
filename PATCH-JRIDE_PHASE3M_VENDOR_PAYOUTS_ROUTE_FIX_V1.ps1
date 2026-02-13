# PATCH-JRIDE_PHASE3M_VENDOR_PAYOUTS_ROUTE_FIX_V1.ps1
# Fix "is not a module" by ensuring vendor-payouts/route.ts exports GET/POST
# - GET: list vendor_wallet_balances_v1
# - POST action=settle: calls settle_vendor_wallet(v_vendor_id, v_note)
# UTF-8 without BOM

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }

function Find-RepoRoot([string]$startDir) {
  $d = Resolve-Path $startDir
  while ($true) {
    if (Test-Path (Join-Path $d "package.json")) { return $d }
    $parent = Split-Path $d -Parent
    if ($parent -eq $d) { break }
    $d = $parent
  }
  Fail "Could not find repo root (package.json)."
}

$root = Find-RepoRoot (Get-Location).Path
$dir  = Join-Path $root "app\api\admin\vendor-payouts"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$target = Join-Path $dir "route.ts"
if (Test-Path $target) {
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  Copy-Item $target "$target.bak.$ts" -Force
  Ok "[OK] Backup: $target.bak.$ts"
}

$code = @'
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function s(v: any) {
  return String(v ?? "").trim();
}

function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;

  return createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(req: NextRequest) {
  try {
    const admin = getAdmin();
    if (!admin) {
      return json(500, {
        ok: false,
        code: "SERVER_MISCONFIG",
        message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1000);

    const { data, error } = await admin
      .from("vendor_wallet_balances_v1")
      .select("vendor_id,balance,last_tx_at,tx_count")
      .order("balance", { ascending: false })
      .limit(limit);

    if (error) {
      return json(500, { ok: false, code: "DB_ERROR", message: error.message });
    }

    return json(200, { ok: true, vendors: data ?? [] });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: String(e?.message || e || "Unknown") });
  }
}

type VendorSettleReq = {
  action?: string | null;
  vendor_id?: string | null;
  vendorId?: string | null;
  note?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const admin = getAdmin();
    if (!admin) {
      return json(500, {
        ok: false,
        code: "SERVER_MISCONFIG",
        message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const body = (await req.json().catch(() => ({}))) as VendorSettleReq;
    const action = s(body.action).toLowerCase();
    if (action !== "settle") {
      return json(400, { ok: false, code: "BAD_REQUEST", message: "action must be 'settle'" });
    }

    const vendor_id = s(body.vendor_id ?? body.vendorId);
    if (!vendor_id) {
      return json(400, { ok: false, code: "BAD_REQUEST", message: "vendor_id required" });
    }

    const note = (body.note === null || body.note === undefined) ? null : s(body.note);

    // Calls DB function: settle_vendor_wallet(v_vendor_id uuid, v_note text DEFAULT ...)
    const { error } = await admin.rpc("settle_vendor_wallet", {
      v_vendor_id: vendor_id,
      v_note: note && note.length ? note : "Cash payout settlement",
    });

    if (error) {
      return json(500, { ok: false, code: "RPC_ERROR", message: error.message });
    }

    return json(200, { ok: true, vendor_id, settled: true });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: String(e?.message || e || "Unknown") });
  }
}
'@

# Write UTF-8 without BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $code, $utf8NoBom)

Ok "[OK] Wrote: $target"
Ok "DONE"
