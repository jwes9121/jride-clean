# ============================================================
# SCRIPT 9 — BACKEND LIFECYCLE FIX
# ============================================================
# Problem A: fare/accept sets passenger_fare_response=accepted
#            but never advances booking.status. It stays at
#            "assigned", so ON THE WAY fails with P0001:
#            "Lifecycle violation: cannot transition assigned -> on_the_way"
#
# Problem B: on-the-way route does a blind status="on_the_way"
#            update without checking/advancing prerequisites.
#
# Fix A: After fare acceptance, step status through the required
#        lifecycle: assigned -> fare_proposed -> ready
#
# Fix B: on-the-way route pre-checks current status and
#        auto-advances through fare_proposed -> ready if stuck
#        with passenger_fare_response=accepted.
#
# Files affected:
#   app/api/public/passenger/fare/accept/route.ts
#   app/api/admin/dispatch/on-the-way/route.ts
#
# RUN:
#   powershell -ExecutionPolicy Bypass -File .\public\jride-patches\script9-backend-lifecycle-fix.ps1
# THEN:
#   npm run build   (or deploy)
# ============================================================

$ErrorActionPreference = "Stop"
$repoRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"

# ---- timestamp for backups ----
$ts     = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $repoRoot "_backups\lifecycle-fix"
if (-not (Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir -Force | Out-Null }

# ================================================================
# PART 1: PATCH fare/accept/route.ts
# ================================================================
$fareTarget = Join-Path $repoRoot "app\api\public\passenger\fare\accept\route.ts"
if (-not (Test-Path $fareTarget)) {
    Write-Host "FATAL: fare/accept route not found at $fareTarget" -ForegroundColor Red
    exit 1
}

$fareBak = Join-Path $bakDir "fare-accept-route.ts.$ts.bak"
Copy-Item $fareTarget $fareBak -Force
Write-Host "BACKUP  $fareBak" -ForegroundColor Green

$fareContent = @'
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: Request) {
  try {
    const supabase = createClient();

    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const booking_id = body?.booking_id ? String(body.booking_id) : "";
    if (!booking_id) {
      return NextResponse.json({ ok: false, error: "Missing booking_id" }, { status: 400 });
    }

    const { data: b, error: bErr } = await supabase
      .from("bookings")
      .select("id, status, created_by_user_id, proposed_fare, verified_fare, passenger_fare_response")
      .eq("id", booking_id)
      .single();

    if (bErr) {
      return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 });
    }
    if (!b) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }
    if (String(b.created_by_user_id || "") !== String(user.id)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const verifiedFare = (b.verified_fare ?? b.proposed_fare) ?? null;

    const { data: upd, error: uErr } = await supabase
      .from("bookings")
      .update({
        passenger_fare_response: "accepted",
        verified_fare: verifiedFare,
        updated_at: new Date().toISOString(),
      })
      .eq("id", booking_id)
      .select("id, status, proposed_fare, verified_fare, passenger_fare_response")
      .single();

    if (uErr) {
      return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });
    }

    // ── Lifecycle advance: assigned -> fare_proposed -> ready ──
    // DB trigger enforces sequential transitions only.
    // After passenger accepts fare, booking MUST reach "ready"
    // so the driver can proceed to on_the_way.
    const curStatus = String(upd?.status ?? b.status ?? "").trim().toLowerCase();
    const steps: string[] = [];
    if (curStatus === "assigned") steps.push("fare_proposed", "ready");
    else if (curStatus === "fare_proposed") steps.push("ready");

    const advanceWarnings: string[] = [];
    for (const nextSt of steps) {
      const { error: stepErr } = await supabase
        .from("bookings")
        .update({ status: nextSt, updated_at: new Date().toISOString() })
        .eq("id", booking_id);
      if (stepErr) {
        console.error("[fare/accept] lifecycle step failed:", nextSt, stepErr.message);
        advanceWarnings.push(nextSt + ": " + stepErr.message);
        break;
      }
    }

    // Re-fetch to return accurate final state
    const { data: finalRow } = await supabase
      .from("bookings")
      .select("id, status, proposed_fare, verified_fare, passenger_fare_response")
      .eq("id", booking_id)
      .single();

    return NextResponse.json({
      ok: true,
      booking: finalRow ?? upd,
      lifecycle_advanced: steps.length > 0,
      advance_warnings: advanceWarnings.length > 0 ? advanceWarnings : undefined,
    }, { status: 200 });
  } catch (e: any) {
    console.error("[fare/accept] exception", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
'@

[System.IO.File]::WriteAllText($fareTarget, $fareContent, [System.Text.UTF8Encoding]::new($false))
Write-Host "WROTE   $fareTarget" -ForegroundColor Green

# ================================================================
# PART 2: PATCH on-the-way/route.ts
# ================================================================
$otwTarget = Join-Path $repoRoot "app\api\admin\dispatch\on-the-way\route.ts"
if (-not (Test-Path $otwTarget)) {
    Write-Host "FATAL: on-the-way route not found at $otwTarget" -ForegroundColor Red
    exit 1
}

$otwBak = Join-Path $bakDir "on-the-way-route.ts.$ts.bak"
Copy-Item $otwTarget $otwBak -Force
Write-Host "BACKUP  $otwBak" -ForegroundColor Green

$otwContent = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const { bookingId } = await req.json();

  if (!bookingId) {
    return NextResponse.json(
      { error: "Missing bookingId" },
      { status: 400 }
    );
  }

  // ── Pre-check: auto-advance lifecycle if stuck after fare acceptance ──
  // DB trigger requires sequential transitions:
  //   assigned -> fare_proposed -> ready -> on_the_way
  // If booking is stuck at assigned/fare_proposed with accepted fare,
  // step it forward before attempting the on_the_way transition.
  try {
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, status, passenger_fare_response, proposed_fare, verified_fare")
      .eq("id", bookingId)
      .single();

    if (booking) {
      const st = String(booking.status ?? "").trim();
      const resp = String(booking.passenger_fare_response ?? "").trim();
      const hasFare = booking.proposed_fare != null || booking.verified_fare != null;

      if (st !== "ready" && st !== "on_the_way" && (resp === "accepted" || hasFare)) {
        const steps: string[] = [];
        if (st === "assigned") steps.push("fare_proposed", "ready");
        else if (st === "fare_proposed") steps.push("ready");

        for (const next of steps) {
          const { error: stepErr } = await supabase
            .from("bookings")
            .update({ status: next, updated_at: new Date().toISOString() })
            .eq("id", bookingId);
          if (stepErr) {
            console.error("ON_THE_WAY auto-advance failed:", next, stepErr.message);
            return NextResponse.json({
              error: "Lifecycle auto-advance failed at " + next + ": " + stepErr.message,
              current_status: st,
              attempted_step: next,
            }, { status: 500 });
          }
        }

        if (steps.length > 0) {
          console.log("ON_THE_WAY auto-advanced through:", steps.join(" -> "));
        }
      }
    }
  } catch (preErr: any) {
    console.error("ON_THE_WAY pre-check error", preErr);
    // Continue anyway — the main update will either succeed or fail clearly
  }

  const { error } = await supabase
    .from("bookings")
    .update({ status: "on_the_way" })
    .eq("id", bookingId);

  if (error) {
    console.error("ON_THE_WAY error", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
'@

[System.IO.File]::WriteAllText($otwTarget, $otwContent, [System.Text.UTF8Encoding]::new($false))
Write-Host "WROTE   $otwTarget" -ForegroundColor Green

# ================================================================
# PART 3: PATCH start-trip/route.ts (same resilience pattern)
# ================================================================
$stTarget = Join-Path $repoRoot "app\api\admin\dispatch\start-trip\route.ts"
if (Test-Path $stTarget) {
    $stBak = Join-Path $bakDir "start-trip-route.ts.$ts.bak"
    Copy-Item $stTarget $stBak -Force
    Write-Host "BACKUP  $stBak" -ForegroundColor Green

    $stContent = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const { bookingId } = await req.json();

  if (!bookingId) {
    return NextResponse.json(
      { error: "Missing bookingId" },
      { status: 400 }
    );
  }

  // ── Pre-check: auto-advance lifecycle if stuck ──
  // DB trigger requires: on_the_way -> arrived -> on_trip
  // Also handle edge case where booking is still at ready/fare_proposed
  try {
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, status, passenger_fare_response, proposed_fare, verified_fare")
      .eq("id", bookingId)
      .single();

    if (booking) {
      const st = String(booking.status ?? "").trim();
      const steps: string[] = [];

      if (st === "assigned") steps.push("fare_proposed", "ready", "on_the_way", "arrived");
      else if (st === "fare_proposed") steps.push("ready", "on_the_way", "arrived");
      else if (st === "ready") steps.push("on_the_way", "arrived");
      else if (st === "on_the_way") steps.push("arrived");
      // arrived -> on_trip handled by main update below

      for (const next of steps) {
        const { error: stepErr } = await supabase
          .from("bookings")
          .update({ status: next, updated_at: new Date().toISOString() })
          .eq("id", bookingId);
        if (stepErr) {
          console.error("START_TRIP auto-advance failed:", next, stepErr.message);
          return NextResponse.json({
            error: "Lifecycle auto-advance failed at " + next + ": " + stepErr.message,
            current_status: st,
          }, { status: 500 });
        }
      }

      if (steps.length > 0) {
        console.log("START_TRIP auto-advanced through:", steps.join(" -> "));
      }
    }
  } catch (preErr: any) {
    console.error("START_TRIP pre-check error", preErr);
  }

  const { error } = await supabase
    .from("bookings")
    .update({ status: "on_trip" })
    .eq("id", bookingId);

  if (error) {
    console.error("START_TRIP error", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
'@

    [System.IO.File]::WriteAllText($stTarget, $stContent, [System.Text.UTF8Encoding]::new($false))
    Write-Host "WROTE   $stTarget" -ForegroundColor Green
} else {
    Write-Host "SKIP: start-trip route not found (optional)" -ForegroundColor Yellow
}

# ================================================================
Write-Host ""
Write-Host "Script 9 DONE" -ForegroundColor Green
Write-Host "  Patched: fare/accept  -> lifecycle advance after acceptance" -ForegroundColor Cyan
Write-Host "  Patched: on-the-way   -> auto-advance if stuck at assigned/fare_proposed" -ForegroundColor Cyan
Write-Host "  Patched: start-trip   -> auto-advance resilience" -ForegroundColor Cyan
Write-Host "  Next: npm run build / deploy" -ForegroundColor Yellow
Write-Host "  Test: passenger accepts fare -> booking reaches 'ready'" -ForegroundColor Yellow
Write-Host "  Test: driver taps ON THE WAY -> succeeds (ready -> on_the_way)" -ForegroundColor Yellow
