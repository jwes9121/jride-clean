# PATCH-JRIDE_DISPATCH_ASSIGN_ACCEPT_CAMELCASE_V1.ps1
# Overwrites app/api/dispatch/assign/route.ts with a compat handler:
# - accepts bookingCode/booking_code, bookingId/booking_id, driverId/driver_id
# - returns correct HTTP codes (400/404/409)
# - assigns booking to driver (sets assigned_driver_id + driver_id + status="assigned")

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m){ Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }

$RepoRoot = (Get-Location).Path
$RouteDir  = Join-Path $RepoRoot "app\api\dispatch\assign"
$RouteFile = Join-Path $RouteDir  "route.ts"

if (!(Test-Path (Join-Path $RepoRoot "app"))) { Fail "Run this from repo root (missing ./app)." }
if (!(Test-Path $RouteDir)) { Fail "Missing dir: $RouteDir" }

# Backup
$bakDir = Join-Path $RepoRoot "_patch_bak"
if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("dispatch_assign.route.ts.bak." + $stamp)
Copy-Item $RouteFile $bak -Force
Ok "Backup: $bak"

# Write full file
$content = @'
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

function pickFirst(body: any, keys: string[]) {
  for (const k of keys) {
    const v = body?.[k];
    if (v !== undefined && v !== null && String(v).trim().length > 0) return String(v).trim();
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    // Accept both camelCase and snake_case
    const bookingCode = pickFirst(body, ["bookingCode", "booking_code"]);
    const bookingId   = pickFirst(body, ["bookingId", "booking_id"]);
    const driverId    = pickFirst(body, ["driverId", "driver_id"]);

    if (!bookingCode && !bookingId) {
      return NextResponse.json(
        { ok: false, code: "BOOKING_NOT_FOUND", message: "Missing booking_id or booking_code" },
        { status: 400 }
      );
    }

    if (!driverId || !isUuidLike(driverId)) {
      return NextResponse.json(
        { ok: false, code: "INVALID_DRIVER_ID", message: "Missing or invalid driver_id/driverId (uuid)" },
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

    // Fetch booking by id or code
    let booking: any = null;

    if (bookingId) {
      const { data, error } = await supabase
        .from("bookings")
        .select("id, booking_code, status, town, assigned_driver_id, driver_id, created_at")
        .eq("id", bookingId)
        .limit(1);

      if (error) {
        return NextResponse.json({ ok: false, code: "DB_SELECT_ERROR", message: error.message }, { status: 500 });
      }
      booking = Array.isArray(data) && data.length ? data[0] : null;
    } else {
      const { data, error } = await supabase
        .from("bookings")
        .select("id, booking_code, status, town, assigned_driver_id, driver_id, created_at")
        .eq("booking_code", bookingCode)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) {
        return NextResponse.json({ ok: false, code: "DB_SELECT_ERROR", message: error.message }, { status: 500 });
      }
      booking = Array.isArray(data) && data.length ? data[0] : null;
    }

    if (!booking) {
      return NextResponse.json(
        { ok: false, code: "BOOKING_NOT_FOUND", message: "Booking not found", booking_id: bookingId || null, booking_code: bookingCode || null },
        { status: 404 }
      );
    }

    const currentStatus = String(booking.status || "").trim();

    // permissive assignable statuses
    const allowedCurrent = ["requested", "booked_ok", "booked", "pending", "created", ""];
    if (allowedCurrent.indexOf(currentStatus) === -1) {
      return NextResponse.json(
        {
          ok: false,
          code: "CANNOT_ASSIGN_FROM_STATUS",
          message: "Booking status is not assignable",
          booking_id: booking.id,
          booking_code: booking.booking_code,
          current_status: currentStatus,
        },
        { status: 409 }
      );
    }

    const patch: any = {
      assigned_driver_id: driverId,
      driver_id: driverId,
      status: "assigned",
    };

    const { data: upd, error: updErr } = await supabase
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

    const updated = Array.isArray(upd) && upd.length ? upd[0] : null;

    return NextResponse.json({
      ok: true,
      note: "ASSIGNED_OK",
      booking_id: updated?.id || booking.id,
      booking_code: updated?.booking_code || booking.booking_code,
      driver_id: driverId,
      updated,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}
'@

$content | Out-File -FilePath $RouteFile -Encoding utf8 -Force
Ok "Wrote: $RouteFile"

# Quick sanity
$txt = Get-Content -Raw -Encoding UTF8 $RouteFile
if ($txt -notmatch "pickFirst" -or $txt -notmatch "bookingCode") {
  Fail "Sanity check failed: file content not as expected."
}
Ok "Sanity OK."
