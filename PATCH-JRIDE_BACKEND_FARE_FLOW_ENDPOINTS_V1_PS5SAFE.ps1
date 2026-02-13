# PATCH-JRIDE_BACKEND_FARE_FLOW_ENDPOINTS_V1_PS5SAFE.ps1
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red; throw $m }

Write-Host "== JRIDE BACKEND PATCH: Fare flow endpoints (V1 / PS5-safe) =="

$Root = Get-Location

function EnsureDir($p){
  if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

# --- Create: /app/api/driver/fare-offer/route.ts ---
$dir1 = Join-Path $Root.Path "app\api\driver\fare-offer"
EnsureDir $dir1
$f1 = Join-Path $dir1 "route.ts"

$code1 = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());
}
function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  return { url, key };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const driver_id = String(body?.driver_id || "").trim();
    const booking_id = String(body?.booking_id || "").trim();
    const booking_code = String(body?.booking_code || "").trim();
    const proposed_fare = Number(body?.proposed_fare);

    if (!driver_id || !isUuidLike(driver_id)) {
      return NextResponse.json({ ok: false, code: "INVALID_DRIVER_ID" }, { status: 400 });
    }
    if ((!booking_id || !isUuidLike(booking_id)) && !booking_code) {
      return NextResponse.json({ ok: false, code: "MISSING_BOOKING" }, { status: 400 });
    }
    if (!Number.isFinite(proposed_fare) || proposed_fare <= 0) {
      return NextResponse.json({ ok: false, code: "INVALID_FARE" }, { status: 400 });
    }

    const env = getSupabaseEnv();
    if (!env.url || !env.key) {
      return NextResponse.json({ ok: false, code: "MISSING_SUPABASE_ENV" }, { status: 500 });
    }
    const supabase = createClient(env.url, env.key);

    // Update booking: keep assigned_driver_id + driver_id intact, set proposed_fare and move to fare_proposed
    const match = booking_id ? { id: booking_id } : { booking_code };

    const { data, error } = await supabase
      .from("bookings")
      .update({
        proposed_fare,
        status: "fare_proposed",
        driver_id,
        assigned_driver_id: driver_id,
        updated_at: new Date().toISOString(),
      })
      .match(match)
      .select("id, booking_code, status, proposed_fare, driver_id, assigned_driver_id, updated_at")
      .limit(1);

    if (error) {
      return NextResponse.json({ ok: false, code: "DB_ERROR", message: error.message }, { status: 500 });
    }

    const row = Array.isArray(data) && data.length ? data[0] : null;
    return NextResponse.json({ ok: true, booking: row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, code: "SERVER_ERROR", message: String(e?.message || e) }, { status: 500 });
  }
}
'@

[System.IO.File]::WriteAllText($f1, $code1, (New-Object System.Text.UTF8Encoding($false)))
Ok "[OK] Wrote /api/driver/fare-offer"

# --- Create: /app/api/passenger/fare-response/route.ts ---
$dir2 = Join-Path $Root.Path "app\api\passenger\fare-response"
EnsureDir $dir2
$f2 = Join-Path $dir2 "route.ts"

$code2 = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());
}
function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  return { url, key };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const booking_id = String(body?.booking_id || "").trim();
    const booking_code = String(body?.booking_code || "").trim();
    const response = String(body?.response || "").trim().toLowerCase(); // accepted | rejected

    if ((!booking_id || !isUuidLike(booking_id)) && !booking_code) {
      return NextResponse.json({ ok: false, code: "MISSING_BOOKING" }, { status: 400 });
    }
    if (response !== "accepted" && response !== "rejected") {
      return NextResponse.json({ ok: false, code: "INVALID_RESPONSE" }, { status: 400 });
    }

    const env = getSupabaseEnv();
    if (!env.url || !env.key) {
      return NextResponse.json({ ok: false, code: "MISSING_SUPABASE_ENV" }, { status: 500 });
    }
    const supabase = createClient(env.url, env.key);

    const match = booking_id ? { id: booking_id } : { booking_code };

    // If accepted => move to on_the_way (driver can proceed)
    // If rejected => clear fare and move back to pending (your auto-assign can re-pick)
    const patch =
      response === "accepted"
        ? { passenger_fare_response: "accepted", status: "on_the_way", updated_at: new Date().toISOString() }
        : {
            passenger_fare_response: "rejected",
            status: "pending",
            proposed_fare: null,
            assigned_driver_id: null,
            driver_id: null,
            updated_at: new Date().toISOString(),
          };

    const { data, error } = await supabase
      .from("bookings")
      .update(patch)
      .match(match)
      .select("id, booking_code, status, proposed_fare, passenger_fare_response, driver_id, assigned_driver_id, updated_at")
      .limit(1);

    if (error) {
      return NextResponse.json({ ok: false, code: "DB_ERROR", message: error.message }, { status: 500 });
    }

    const row = Array.isArray(data) && data.length ? data[0] : null;
    return NextResponse.json({ ok: true, booking: row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, code: "SERVER_ERROR", message: String(e?.message || e) }, { status: 500 });
  }
}
'@

[System.IO.File]::WriteAllText($f2, $code2, (New-Object System.Text.UTF8Encoding($false)))
Ok "[OK] Wrote /api/passenger/fare-response"

Ok "DONE."
