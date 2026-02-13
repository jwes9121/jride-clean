# PATCH-JRIDE_PHASE3M2_CREATE_RECONCILE_WALLETS_ROUTE_V1.ps1
# Creates app/api/admin/reconcile-wallets/route.ts (READ-ONLY)
# Flags:
# - completed trips missing driver wallet tx (by booking_id)
# - completed takeout missing vendor earning tx (by booking_code, kind='earning')
# - duplicate driver credits per booking_id
# - duplicate vendor earnings per booking_code
# - negative balances (driver/vendor)
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
$dir = Join-Path $root "app\api\admin\reconcile-wallets"
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
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "300", 10) || 300, 1000);

    // 1) Completed bookings
    const { data: bookings, error: bErr } = await admin
      .from("bookings")
      .select("id,booking_code,status,service_type,vendor_status,driver_id,vendor_id,completed_at,updated_at")
      .eq("status", "completed")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (bErr) return json(500, { ok: false, code: "DB_ERROR", stage: "bookings", message: bErr.message });

    const completed = bookings || [];
    const completedIds = completed.map((x: any) => x.id).filter(Boolean);
    const completedCodes = completed.map((x: any) => x.booking_code).filter(Boolean);

    // 2) Driver wallet tx for completed booking ids (table exists in your schema)
    const { data: driverTx, error: dErr } = await admin
      .from("driver_wallet_transactions")
      .select("id,driver_id,amount,reason,booking_id,created_at")
      .in("booking_id", completedIds.length ? completedIds : ["00000000-0000-0000-0000-000000000000"])
      .order("created_at", { ascending: false })
      .limit(5000);

    if (dErr) return json(500, { ok: false, code: "DB_ERROR", stage: "driver_wallet_transactions", message: dErr.message });

    // 3) Vendor wallet tx for completed booking codes (table exists in your schema)
    const { data: vendorTx, error: vErr } = await admin
      .from("vendor_wallet_transactions")
      .select("id,vendor_id,booking_code,amount,kind,note,created_at")
      .in("booking_code", completedCodes.length ? completedCodes : ["__none__"])
      .order("created_at", { ascending: false })
      .limit(5000);

    if (vErr) return json(500, { ok: false, code: "DB_ERROR", stage: "vendor_wallet_transactions", message: vErr.message });

    // 4) Negative balances (views exist)
    const { data: dBal, error: dBalErr } = await admin
      .from("driver_wallet_balances_v1")
      .select("driver_id,balance,last_tx_at,tx_count")
      .lt("balance", 0)
      .order("balance", { ascending: true })
      .limit(200);

    if (dBalErr) return json(500, { ok: false, code: "DB_ERROR", stage: "driver_wallet_balances_v1", message: dBalErr.message });

    const { data: vBal, error: vBalErr } = await admin
      .from("vendor_wallet_balances_v1")
      .select("vendor_id,balance,last_tx_at,tx_count")
      .lt("balance", 0)
      .order("balance", { ascending: true })
      .limit(200);

    if (vBalErr) return json(500, { ok: false, code: "DB_ERROR", stage: "vendor_wallet_balances_v1", message: vBalErr.message });

    // ---- Compute flags ----

    // Driver tx by booking_id
    const txByBooking: Record<string, any[]> = {};
    for (const t of driverTx || []) {
      const bid = s((t as any).booking_id);
      if (!bid) continue;
      if (!txByBooking[bid]) txByBooking[bid] = [];
      txByBooking[bid].push(t);
    }

    const missing_driver_credits = completed
      .filter((b: any) => !!b.driver_id)
      .filter((b: any) => !txByBooking[s(b.id)] || txByBooking[s(b.id)].length === 0)
      .map((b: any) => ({
        booking_id: b.id,
        booking_code: b.booking_code ?? null,
        driver_id: b.driver_id ?? null,
        service_type: b.service_type ?? null,
        completed_at: b.completed_at ?? null,
        updated_at: b.updated_at ?? null,
      }))
      .slice(0, 500);

    const duplicate_driver_credits = Object.keys(txByBooking)
      .filter((bid) => (txByBooking[bid]?.length || 0) > 1)
      .map((bid) => ({
        booking_id: bid,
        count: txByBooking[bid].length,
        tx: txByBooking[bid].slice(0, 5),
      }))
      .slice(0, 300);

    // Vendor tx by booking_code
    const vtxByCode: Record<string, any[]> = {};
    for (const t of vendorTx || []) {
      const code = s((t as any).booking_code);
      if (!code) continue;
      if (!vtxByCode[code]) vtxByCode[code] = [];
      vtxByCode[code].push(t);
    }

    const takeoutCompleted = completed.filter((b: any) =>
      s(b.service_type).toLowerCase() === "takeout" &&
      s(b.vendor_status).toLowerCase() === "completed" &&
      !!b.vendor_id &&
      !!b.booking_code
    );

    const missing_vendor_credits = takeoutCompleted
      .filter((b: any) => {
        const code = s(b.booking_code);
        const list = vtxByCode[code] || [];
        return list.filter((t: any) => s(t.kind).toLowerCase() === "earning").length === 0;
      })
      .map((b: any) => ({
        booking_code: b.booking_code,
        booking_id: b.id,
        vendor_id: b.vendor_id ?? null,
        vendor_status: b.vendor_status ?? null,
        completed_at: b.completed_at ?? null,
        updated_at: b.updated_at ?? null,
      }))
      .slice(0, 500);

    const duplicate_vendor_earnings = Object.keys(vtxByCode)
      .map((code) => {
        const earnings = (vtxByCode[code] || []).filter((t: any) => s(t.kind).toLowerCase() === "earning");
        return { code, earnings };
      })
      .filter((x) => x.earnings.length > 1)
      .map((x) => ({
        booking_code: x.code,
        count: x.earnings.length,
        tx: x.earnings.slice(0, 5),
      }))
      .slice(0, 300);

    const summary = {
      completed_count: completed.length,
      completed_takeout_vendor_completed_count: takeoutCompleted.length,
      driver_tx_seen: (driverTx || []).length,
      vendor_tx_seen: (vendorTx || []).length,
      missing_driver_credits_count: missing_driver_credits.length,
      missing_vendor_credits_count: missing_vendor_credits.length,
      duplicate_driver_credits_count: duplicate_driver_credits.length,
      duplicate_vendor_earnings_count: duplicate_vendor_earnings.length,
      negative_driver_balances_count: (dBal || []).length,
      negative_vendor_balances_count: (vBal || []).length,
    };

    return json(200, {
      ok: true,
      summary,
      missing_driver_credits,
      duplicate_driver_credits,
      missing_vendor_credits,
      duplicate_vendor_earnings,
      negative_driver_balances: dBal || [],
      negative_vendor_balances: vBal || [],
    });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: String(e?.message || e || "Unknown") });
  }
}
'@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $code, $utf8NoBom)

Ok "[OK] Wrote: $target"
Ok "DONE"
