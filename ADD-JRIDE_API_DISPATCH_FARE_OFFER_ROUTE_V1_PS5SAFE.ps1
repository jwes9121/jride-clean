# ADD-JRIDE_API_DISPATCH_FARE_OFFER_ROUTE_V1_PS5SAFE.ps1
# Creates: app/api/dispatch/fare/offer/route.ts
# Purpose: driver offers fare -> saves proposed_fare + verified_fare and sets status=accepted

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red }

$RepoRoot = (Get-Location).Path
Ok "== JRIDE BACKEND: Add /api/dispatch/fare/offer route (V1 / PS5-safe) =="
Ok ("RepoRoot: {0}" -f $RepoRoot)

$rel = "app\api\dispatch\fare\offer"
$dir = Join-Path $RepoRoot $rel
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$target = Join-Path $dir "route.ts"
if (Test-Path $target) {
  Warn ("[WARN] route.ts already exists: {0}" -f $target)
  Warn "Overwriting with V1 content."
}

$ts = @'
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Body = {
  bookingId?: string | null;
  bookingCode?: string | null;
  driverId?: string | null;

  // Driver-entered fare EXCLUDING convenience fee
  fare?: number | string | null;

  // Convenience fee to add (defaults to 15)
  convenienceFee?: number | string | null;

  // Optional source label
  source?: string | null;
};

function num(x: any, d: number) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as Body;

    const bookingId = String(body.bookingId ?? "").trim();
    const bookingCode = String(body.bookingCode ?? "").trim();
    const driverId = String(body.driverId ?? "").trim();
    const source = String(body.source ?? "android").trim();

    if (!driverId) return NextResponse.json({ ok: false, code: "MISSING_DRIVER_ID" }, { status: 400 });
    if (!bookingId && !bookingCode) {
      return NextResponse.json({ ok: false, code: "MISSING_BOOKING_IDENTIFIER" }, { status: 400 });
    }

    const baseFare = num(body.fare, NaN);
    if (!Number.isFinite(baseFare) || baseFare <= 0) {
      return NextResponse.json({ ok: false, code: "INVALID_FARE" }, { status: 400 });
    }

    const conv = num(body.convenienceFee, 15);
    const total = Math.round((baseFare + conv) * 100) / 100;

    // Resolve booking
    let readQ = supabase.from("bookings").select("id, booking_code, status, driver_id, assigned_driver_id").limit(1);
    if (bookingId) readQ = readQ.eq("id", bookingId);
    else readQ = readQ.eq("booking_code", bookingCode);

    const { data: rows, error: selErr } = await readQ;
    if (selErr) {
      return NextResponse.json({ ok: false, code: "FARE_OFFER_SELECT_ERROR", message: selErr.message }, { status: 500 });
    }
    const b = rows?.[0];
    if (!b?.id) return NextResponse.json({ ok: false, code: "BOOKING_NOT_FOUND" }, { status: 404 });

    // Basic safety: if booking is already completed/cancelled, block
    const st = String(b.status ?? "").toLowerCase().trim();
    if (st === "completed" || st === "cancelled" || st === "on_trip") {
      return NextResponse.json({ ok: false, code: "BOOKING_NOT_OFFERABLE", status: b.status }, { status: 409 });
    }

    // Save offer + auto-verify so passenger can accept immediately
    const now = new Date().toISOString();
    const patch: any = {
      proposed_fare: total,
      verified_fare: total,
      verified_reason: "driver_offer_auto",
      verified_at: now,
      passenger_fare_response: null,

      // Ensure driver assignment is present
      driver_id: driverId,
      assigned_driver_id: driverId,
      assigned_at: now,

      // Hold state for passenger decision
      status: "accepted",

      updated_at: now,
    };

    const { error: upErr } = await supabase.from("bookings").update(patch).eq("id", b.id);
    if (upErr) {
      return NextResponse.json(
        { ok: false, code: "FARE_OFFER_DB_ERROR", message: upErr.message, source },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, booking_id: b.id, booking_code: b.booking_code, total_fare: total, base_fare: baseFare, convenience_fee: conv },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, code: "FARE_OFFER_FATAL", message: String(e?.message ?? e) }, { status: 500 });
  }
}
'@

[System.IO.File]::WriteAllText($target, $ts, (New-Object System.Text.UTF8Encoding($false)))
Ok ("[OK] Wrote: {0}" -f $target)
Ok "== DONE =="
