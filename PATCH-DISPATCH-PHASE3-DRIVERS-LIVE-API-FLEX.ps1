# PATCH-DISPATCH-PHASE3-DRIVERS-LIVE-API-FLEX.ps1
$ErrorActionPreference = "Stop"

$target = "app/api/dispatch/drivers-live/route.ts"

# Backup
if (Test-Path $target) {
  $bak = "$target.bak.$(Get-Date -Format yyyyMMdd-HHmmss)"
  Copy-Item $target $bak
  Write-Host "[OK] Backup created: $bak" -ForegroundColor Green
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
}

@'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Be flexible with env var names across your project
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE_ROLE?.trim();

if (!SUPABASE_URL || !SERVICE_KEY) {
  // Avoid leaking env values; just return a clear error
  console.error("drivers-live: missing SUPABASE_URL or service key env var");
}

const supabase = createClient(SUPABASE_URL as string, SERVICE_KEY as string);

function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined) return obj[k];
  }
  return undefined;
}

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBool(v: any) {
  if (v === true) return true;
  if (v === false) return false;
  if (v === 1 || v === "1" || v === "true" || v === "TRUE" || v === "yes" || v === "YES") return true;
  if (v === 0 || v === "0" || v === "false" || v === "FALSE" || v === "no" || v === "NO") return false;
  return null;
}

export async function GET() {
  try {
    // Prefer your live view (your error mentions my_driver_live)
    let src = "my_driver_live";
    let { data, error } = await supabase.from(src).select("*");

    // Fallback to drivers table if view missing/blocked
    if (error) {
      src = "drivers";
      const r2 = await supabase.from(src).select("*");
      data = r2.data as any;
      error = r2.error as any;
    }

    if (error) {
      return NextResponse.json(
        { ok: false, code: "DRIVERS_LIVE_QUERY_FAILED", message: error.message },
        { status: 500 }
      );
    }

    const out: Record<string, any> = {};

    for (const row of (data || []) as any[]) {
      // driver id keys vary across views
      const driverId =
        pickFirst(row, ["driver_id", "id", "driver_uuid", "uid"]) ??
        null;

      if (!driverId) continue;

      const walletBal = pickFirst(row, ["wallet_balance", "balance", "wallet", "driver_wallet_balance"]);
      const minReq = pickFirst(row, ["min_wallet_required", "min_required", "min_wallet", "minimum_wallet_required"]);
      const lockedRaw = pickFirst(row, ["wallet_locked", "is_wallet_locked", "wallet_is_locked", "locked", "is_locked", "walletLock"]);

      const lastSeen =
        pickFirst(row, ["location_updated_at", "updated_at", "last_seen", "last_seen_at", "last_location_at"]) ?? null;

      // Optional live status keys (won't break if absent)
      const liveStatus =
        pickFirst(row, ["driver_status", "status", "live_status", "online_status"]) ?? null;

      out[String(driverId)] = {
        driver_status: liveStatus,
        wallet_balance: toNum(walletBal),
        min_wallet_required: toNum(minReq),
        wallet_locked: toBool(lockedRaw) ?? false,
        location_updated_at: lastSeen ? String(lastSeen) : null,
        _src: src
      };
    }

    return NextResponse.json({ ok: true, drivers: out });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, code: "DRIVERS_LIVE_EXCEPTION", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}
'@ | Set-Content $target -Encoding UTF8

Write-Host "[OK] Patched: $target (schema-flexible, uses my_driver_live first)" -ForegroundColor Green
Write-Host "[NEXT] npm.cmd run build" -ForegroundColor Cyan
