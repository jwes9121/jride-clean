# PATCH-JRIDE_ADD_DISPATCH_ASSIGN_ROUTE_V1.ps1
# Creates: app/api/dispatch/assign/route.ts
# Purpose: enable force-assign booking -> driver in PROD (fixes 404 on /api/dispatch/assign)

$ErrorActionPreference = "Stop"

# ---- Settings ----
$RepoRoot = (Get-Location).Path

function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }

# ---- Paths ----
$RouteDir  = Join-Path $RepoRoot "app\api\dispatch\assign"
$RouteFile = Join-Path $RouteDir  "route.ts"

Ok "RepoRoot: $RepoRoot"
Ok "Target:  $RouteFile"

if (!(Test-Path (Join-Path $RepoRoot "app"))) {
  Fail "This does not look like the Next.js repo root (missing ./app). cd into repo root first."
}

# Backup (if exists)
if (Test-Path $RouteFile) {
  $bakDir = Join-Path $RepoRoot "_patch_bak"
  if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = Join-Path $bakDir ("route.ts.assign.bak." + $stamp)
  Copy-Item $RouteFile $bak -Force
  Warn "Backup created: $bak"
}

# Ensure directory exists
if (!(Test-Path $RouteDir)) {
  New-Item -ItemType Directory -Path $RouteDir | Out-Null
  Ok "Created dir: $RouteDir"
}

# ---- Write route.ts (complete file) ----
# Notes:
# - Validates bookingCode + driverId
# - Updates bookings table:
#   - assigned_driver_id = driverId
#   - driver_id = driverId (for compatibility with code that checks either)
#   - status = "assigned" (only if status is requested/booked_ok/booked_ok-ish)
# - Returns updated booking record summary
$routeTs = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());
}

function getSupabaseEnv() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";

  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

  return { url, key };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const bookingCode = String(body?.bookingCode || body?.booking_code || "").trim();
    const driverId = String(body?.driverId || body?.driver_id || "").trim();

    if (!bookingCode) {
      return NextResponse.json(
        { ok: false, code: "MISSING_BOOKING_CODE", message: "bookingCode is required." },
        { status: 400 }
      );
    }
    if (!driverId || !isUuidLike(driverId)) {
      return NextResponse.json(
        { ok: false, code: "INVALID_DRIVER_ID", message: "driverId/driver_id is required (uuid)." },
        { status: 400 }
      );
    }

    const env = getSupabaseEnv();
    if (!env.url || !env.key) {
      return NextResponse.json(
        {
          ok: false,
          code: "MISSING_SUPABASE_ENV",
          message:
            "Missing SUPABASE env. Need NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_URL + SUPABASE_ANON_KEY).",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(env.url, env.key);

    // Fetch booking first (so we can respond cleanly + sanity-check status)
    const { data: rows, error: selErr } = await supabase
      .from("bookings")
      .select("id, booking_code, status, town, assigned_driver_id, driver_id, created_at")
      .eq("booking_code", bookingCode)
      .order("created_at", { ascending: false })
      .limit(1);

    if (selErr) {
      return NextResponse.json(
        { ok: false, code: "DB_SELECT_ERROR", message: selErr.message },
        { status: 500 }
      );
    }

    const booking = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!booking) {
      return NextResponse.json(
        { ok: false, code: "BOOKING_NOT_FOUND", message: "No booking found for booking_code.", booking_code: bookingCode },
        { status: 404 }
      );
    }

    const currentStatus = String(booking.status || "").trim();

    // Allow assignment only for early statuses
    // (keep this permissive to avoid blocking smoke test)
    const allowedCurrent = ["requested", "booked_ok", "booked", "pending", "created", ""];
    const canAssign = allowedCurrent.includes(currentStatus);

    if (!canAssign) {
      return NextResponse.json(
        {
          ok: false,
          code: "CANNOT_ASSIGN_FROM_STATUS",
          message: "Booking status is not assignable.",
          booking_id: booking.id,
          booking_code: booking.booking_code,
          current_status: currentStatus,
        },
        { status: 409 }
      );
    }

    // Perform update
    const patch: any = {
      assigned_driver_id: driverId,
      driver_id: driverId,
      status: "assigned",
    };

    const { data: updRows, error: updErr } = await supabase
      .from("bookings")
      .update(patch)
      .eq("id", booking.id)
      .select("id, booking_code, status, town, assigned_driver_id, driver_id, created_at")
      .limit(1);

    if (updErr) {
      return NextResponse.json(
        { ok: false, code: "DB_UPDATE_ERROR", message: updErr.message, booking_id: booking.id, booking_code: booking.booking_code },
        { status: 500 }
      );
    }

    const updated = Array.isArray(updRows) && updRows.length > 0 ? updRows[0] : null;

    return NextResponse.json({
      ok: true,
      booking_code: bookingCode,
      driver_id: driverId,
      updated,
      note: "ASSIGNED_OK",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}
'@

$routeTs | Out-File -FilePath $RouteFile -Encoding utf8 -Force
Ok "Wrote: $RouteFile"

# Quick sanity: ensure file contains POST handler
$txt = Get-Content -Raw -Encoding UTF8 $RouteFile
if ($txt -notmatch "export async function POST") {
  Fail "Sanity check failed: POST handler not found in route.ts"
}
Ok "Sanity OK: POST handler present."

Write-Host ""
Ok "NEXT: run a Vercel deploy (push)."
