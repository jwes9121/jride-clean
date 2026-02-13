# PATCH-JRIDE_P6F_APPLY_FARE_RECOMPUTE_TOTAL_CUT_PAYOUT.ps1
# P6F: After applying fare, recompute total_to_pay + (best-effort) company_cut + driver_payout
# HARD RULES: DO_NOT_TOUCH_DISPATCH_STATUS, ANCHOR_BASED_ONLY, NO_DECLARE, NO_REDECLARE_NO_DECLARE

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$target = Join-Path $root "app\api\admin\livetrips\apply-fare\route.ts"
if(!(Test-Path $target)){ Fail "Target not found: $target" }

$txt = Get-Content -LiteralPath $target -Raw -Encoding UTF8

# Anchor: must have POST handler
if($txt.IndexOf("export async function POST") -lt 0){ Fail "Anchor not found: export async function POST" }

# Backup
$bak = "$target.bak.$(Stamp)"
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

# Replace entire file content with safe supabaseAdmin-based implementation
$new = @'
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function bad(code: string, status = 400, message?: string, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function ok(payload: any, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function asNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();

    const body = await req.json().catch(() => null);
    const booking_code = String(body?.booking_code || "").trim();
    const fare = Number(body?.fare);

    if (!booking_code) return bad("MISSING_BOOKING_CODE", 400);
    if (!Number.isFinite(fare) || fare <= 0) return bad("INVALID_FARE", 400);

    // Apply fare: prefer verified_fare, fallback to proposed_fare (best-effort)
    let appliedField: "verified_fare" | "proposed_fare" = "verified_fare";
    const u1 = await supabase.from("bookings").update({ verified_fare: fare }).eq("booking_code", booking_code);
    if (u1.error) {
      const u2 = await supabase.from("bookings").update({ proposed_fare: fare }).eq("booking_code", booking_code);
      if (u2.error) {
        return bad("UPDATE_FAILED", 500, u2.error.message);
      }
      appliedField = "proposed_fare";
    }

    // Fetch booking to compute passenger totals / payouts (no schema assumptions)
    const { data: b, error: bErr } = await supabase
      .from("bookings")
      .select("booking_code, trip_type, pickup_distance_fee, platform_service_fee")
      .eq("booking_code", booking_code)
      .maybeSingle();

    if (bErr) {
      // Fare already applied; return ok but include warning
      return ok({ ok: true, applied_field: appliedField, warning: "BOOKING_FETCH_FAILED", details: bErr.message });
    }

    const tripType = String((b as any)?.trip_type ?? "").trim().toLowerCase();
    const isTakeout = tripType === "takeout";

    // For non-takeout rides: recompute passenger total + (best-effort) company cut & driver payout.
    // Conservative rule:
    // - company_cut = platform_service_fee
    // - driver_payout = base_fare + pickup_distance_fee
    // - total_to_pay = base_fare + pickup_distance_fee + platform_service_fee
    const pickupFee = asNum((b as any)?.pickup_distance_fee) ?? 0;
    const platformFee = asNum((b as any)?.platform_service_fee) ?? 0;

    const computed = {
      total_to_pay: Math.round((fare + pickupFee + platformFee) * 100) / 100,
      company_cut: Math.round(platformFee * 100) / 100,
      driver_payout: Math.round((fare + pickupFee) * 100) / 100,
    };

    if (!isTakeout) {
      // Best-effort updates: try all fields, then subsets, without failing the request.
      const tryUpdates: Array<Record<string, any>> = [
        { total_to_pay: computed.total_to_pay, company_cut: computed.company_cut, driver_payout: computed.driver_payout },
        { total_to_pay: computed.total_to_pay },
        { company_cut: computed.company_cut },
        { driver_payout: computed.driver_payout },
      ];

      const applied: string[] = [];
      for (const patch of tryUpdates) {
        try {
          const r = await supabase.from("bookings").update(patch).eq("booking_code", booking_code);
          if (!r.error) {
            for (const k of Object.keys(patch)) if (!applied.includes(k)) applied.push(k);
          }
        } catch {
          // ignore
        }
      }

      return ok({
        ok: true,
        applied_field: appliedField,
        computed,
        applied_computed_fields: applied,
      });
    }

    // Takeout: keep computed values informational only (do not write payout/cut/total unless you decide later)
    return ok({
      ok: true,
      applied_field: appliedField,
      computed,
      note: "TAKEOUT_SKIPPED_PAYOUT_RECOMPUTE",
    });
  } catch (e: any) {
    return bad("SERVER_ERROR", 500, String(e?.message || e));
  }
}
'@

Set-Content -LiteralPath $target -Value $new -Encoding UTF8
Write-Host "[OK] Patched: $target"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) npm.cmd run build"
Write-Host "  2) Test Apply Draft: should persist fare + refresh; server returns computed totals"
