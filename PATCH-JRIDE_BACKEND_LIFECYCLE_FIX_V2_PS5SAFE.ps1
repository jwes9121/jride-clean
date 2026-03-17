param(
  [string]$WebRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

function Read-Text([string]$Path) {
  if (!(Test-Path $Path)) { throw "Missing file: $Path" }
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $enc)
}

function Backup-File([string]$Path, [string]$Tag) {
  $dir = Split-Path -Parent $Path
  $bakDir = Join-Path $dir "_patch_bak"
  if (!(Test-Path $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir -Force | Out-Null
  }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = Split-Path $Path -Leaf
  $bak = Join-Path $bakDir "$name.bak.$Tag.$stamp"
  Copy-Item $Path $bak -Force
  return $bak
}

Write-Host "== JRIDE BACKEND LIFECYCLE FIX V2 (PS5-safe) =="

$fareAcceptTarget = Join-Path $WebRoot "app\api\public\passenger\fare\accept\route.ts"
$onTheWayTarget   = Join-Path $WebRoot "app\api\admin\dispatch\on-the-way\route.ts"

if (!(Test-Path $fareAcceptTarget)) { throw "Missing file: $fareAcceptTarget" }
if (!(Test-Path $onTheWayTarget))   { throw "Missing file: $onTheWayTarget" }

$bak1 = Backup-File -Path $fareAcceptTarget -Tag "LIFECYCLE_FIX_V2"
$bak2 = Backup-File -Path $onTheWayTarget   -Tag "LIFECYCLE_FIX_V2"
Write-Host "[OK] Backup: $bak1" -ForegroundColor Green
Write-Host "[OK] Backup: $bak2" -ForegroundColor Green

# -------------------------------------------------------------------
# PATCH 1: app/api/public/passenger/fare/accept/route.ts
# Rebuild the route so passenger accept records the decision and then
# advances lifecycle in the DB-legal sequence:
# assigned -> accepted -> fare_proposed -> ready
# accepted -> fare_proposed -> ready
# fare_proposed -> ready
# -------------------------------------------------------------------
$fareAcceptContent = @'
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
      .select("id, status, created_by_user_id, proposed_fare, verified_fare, passenger_fare_response, driver_id, assigned_driver_id")
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
      .select("id, status, proposed_fare, verified_fare, passenger_fare_response, driver_id, assigned_driver_id")
      .single();

    if (uErr) {
      return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });
    }

    const curStatus = String(upd?.status ?? b.status ?? "").trim().toLowerCase();
    const steps: string[] = [];

    if (curStatus === "assigned") {
      steps.push("accepted", "fare_proposed", "ready");
    } else if (curStatus === "accepted") {
      steps.push("fare_proposed", "ready");
    } else if (curStatus === "fare_proposed") {
      steps.push("ready");
    }

    const advanceWarnings: string[] = [];

    for (const nextSt of steps) {
      const { error: stepErr } = await supabase
        .from("bookings")
        .update({
          status: nextSt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", booking_id);

      if (stepErr) {
        console.error("[fare/accept] lifecycle step failed:", nextSt, stepErr.message);
        advanceWarnings.push(nextSt + ": " + stepErr.message);
        break;
      }
    }

    const { data: finalRow } = await supabase
      .from("bookings")
      .select("id, status, proposed_fare, verified_fare, passenger_fare_response, driver_id, assigned_driver_id")
      .eq("id", booking_id)
      .single();

    return NextResponse.json(
      {
        ok: true,
        booking: finalRow ?? upd,
        lifecycle_advanced: steps.length > 0,
        advance_warnings: advanceWarnings.length > 0 ? advanceWarnings : undefined,
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("[fare/accept] exception", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
'@

Write-Utf8NoBom -Path $fareAcceptTarget -Content $fareAcceptContent
Write-Host "[OK] Rewrote: $fareAcceptTarget" -ForegroundColor Green

# -------------------------------------------------------------------
# PATCH 2: app/api/admin/dispatch/on-the-way/route.ts
# Pre-advance using the same DB-legal sequence before writing on_the_way.
# -------------------------------------------------------------------
$onTheWayContent = @'
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

  try {
    const { data: booking, error: readErr } = await supabase
      .from("bookings")
      .select("id, status, passenger_fare_response, proposed_fare, verified_fare, driver_id, assigned_driver_id")
      .eq("id", bookingId)
      .single();

    if (readErr) {
      console.error("ON_THE_WAY read error", readErr);
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }
    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const st = String(booking.status ?? "").trim().toLowerCase();
    const resp = String(booking.passenger_fare_response ?? "").trim().toLowerCase();
    const hasFare = booking.proposed_fare != null || booking.verified_fare != null;

    const steps: string[] = [];

    if (st === "assigned" && (resp === "accepted" || hasFare)) {
      steps.push("accepted", "fare_proposed", "ready");
    } else if (st === "accepted" && (resp === "accepted" || hasFare)) {
      steps.push("fare_proposed", "ready");
    } else if (st === "fare_proposed" && resp === "accepted") {
      steps.push("ready");
    }

    for (const nextSt of steps) {
      const { error: stepErr } = await supabase
        .from("bookings")
        .update({
          status: nextSt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", bookingId);

      if (stepErr) {
        console.error("ON_THE_WAY auto-advance failed", nextSt, stepErr);
        return NextResponse.json(
          {
            error: "Lifecycle auto-advance failed",
            attempted_step: nextSt,
            message: stepErr.message,
            current_status: st,
          },
          { status: 500 }
        );
      }
    }

    const { error } = await supabase
      .from("bookings")
      .update({
        status: "on_the_way",
        updated_at: new Date().toISOString(),
      })
      .eq("id", bookingId);

    if (error) {
      console.error("ON_THE_WAY error", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("ON_THE_WAY unexpected", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
'@

Write-Utf8NoBom -Path $onTheWayTarget -Content $onTheWayContent
Write-Host "[OK] Rewrote: $onTheWayTarget" -ForegroundColor Green

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1) npm run build"
Write-Host "  2) Deploy"
Write-Host "  3) Test: fare accept -> on_the_way"