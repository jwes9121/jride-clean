param(
  [Parameter(Mandatory=$true)]
  [string]$WebRoot
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg) { Write-Host "[INFO] $msg" }
function Write-Ok($msg) { Write-Host "[OK] $msg" }
function Fail($msg) { throw $msg }

function Ensure-File($path) {
  if (-not (Test-Path -LiteralPath $path)) {
    Fail "Target file not found: $path"
  }
}

function Backup-File($path, $tag) {
  $dir = Split-Path -Parent $path
  $bakDir = Join-Path $dir '_patch_bak'
  if (-not (Test-Path -LiteralPath $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir | Out-Null
  }
  $name = Split-Path -Leaf $path
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $bak = Join-Path $bakDir ($name + '.bak.' + $tag + '.' + $stamp)
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Write-Ok "Backup: $bak"
}

function Write-Utf8NoBom($path, $content) {
  $dir = Split-Path -Parent $path
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
  Write-Ok "Wrote: $path"
}

$files = @{
  Propose      = Join-Path $WebRoot 'app/api/driver/fare/propose/route.ts'
  FareOffer    = Join-Path $WebRoot 'app/api/driver/fare-offer/route.ts'
  DispatchOffer= Join-Path $WebRoot 'app/api/dispatch/fare/offer/route.ts'
  RidesFare    = Join-Path $WebRoot 'app/api/rides/fare/route.ts'
  PassengerRead= Join-Path $WebRoot 'app/api/public/passenger/booking/route.ts'
}

$files.GetEnumerator() | ForEach-Object { Ensure-File $_.Value }
$files.GetEnumerator() | ForEach-Object { Backup-File $_.Value 'BACKEND_ALIGNMENT_CANONICAL_ROUTE_OWNERSHIP_V1' }

$proposeContent = @'
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Body = {
  driver_id?: string | null;
  driverId?: string | null;
  booking_id?: string | null;
  bookingId?: string | null;
  booking_code?: string | null;
  bookingCode?: string | null;
  proposed_fare?: number | string | null;
};

function pickFirstString(values: any[]): string {
  for (const value of values) {
    const s = String(value ?? "").trim();
    if (s) return s;
  }
  return "";
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function parseMoney(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

const ALLOWED_STATUSES = new Set([
  "pending",
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
]);

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as Body;

    const requestedDriverId = pickFirstString([body.driver_id, body.driverId]);
    const bookingId = pickFirstString([body.booking_id, body.bookingId]);
    const bookingCode = pickFirstString([body.booking_code, body.bookingCode]);
    const proposedFare = parseMoney(body.proposed_fare);

    if (!bookingId && !bookingCode) {
      return NextResponse.json({ ok: false, error: "MISSING_BOOKING_ID" }, { status: 400 });
    }

    if (!Number.isFinite(proposedFare) || proposedFare < 0) {
      return NextResponse.json({ ok: false, error: "INVALID_PROPOSED_FARE" }, { status: 400 });
    }

    let selectQuery = supabase
      .from("bookings")
      .select("id, booking_code, status, driver_id, assigned_driver_id, proposed_fare, passenger_fare_response")
      .limit(1);

    selectQuery = bookingId ? selectQuery.eq("id", bookingId) : selectQuery.eq("booking_code", bookingCode);

    const { data: bookingRows, error: bookingError } = await selectQuery;
    if (bookingError) {
      return NextResponse.json({ ok: false, error: "DB_SELECT_ERROR", message: bookingError.message }, { status: 500 });
    }

    const booking = bookingRows?.[0] as any;
    if (!booking?.id) {
      return NextResponse.json({ ok: false, error: "BOOKING_NOT_FOUND" }, { status: 404 });
    }

    const currentStatus = normalizeStatus(booking.status);
    if (currentStatus && !ALLOWED_STATUSES.has(currentStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error: "NOT_ALLOWED",
          message: "Booking status not allowed for fare proposal.",
          status: currentStatus,
        },
        { status: 409 }
      );
    }

    const currentDriverId = pickFirstString([booking.driver_id]);
    const currentAssignedDriverId = pickFirstString([booking.assigned_driver_id]);

    if (
      requestedDriverId &&
      currentAssignedDriverId &&
      requestedDriverId !== currentAssignedDriverId &&
      currentStatus !== "pending"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "DRIVER_MISMATCH",
          message: "Requested driver does not match the booking's assigned driver.",
          booking_driver_id: currentDriverId || null,
          assigned_driver_id: currentAssignedDriverId || null,
          requested_driver_id: requestedDriverId,
        },
        { status: 409 }
      );
    }

    const effectiveDriverId = pickFirstString([requestedDriverId, currentAssignedDriverId, currentDriverId]);
    const nowIso = new Date().toISOString();
    const updatePayload: Record<string, any> = {
      proposed_fare: proposedFare,
      passenger_fare_response: null,
      status: "fare_proposed",
      updated_at: nowIso,
    };

    if (effectiveDriverId) {
      updatePayload.driver_id = effectiveDriverId;
      updatePayload.assigned_driver_id = effectiveDriverId;
    }

    const { data: updatedRows, error: updateError } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", booking.id)
      .select("id, booking_code, status, driver_id, assigned_driver_id, proposed_fare, passenger_fare_response, updated_at")
      .limit(1);

    if (updateError) {
      return NextResponse.json({ ok: false, error: "DB_UPDATE_ERROR", message: updateError.message }, { status: 500 });
    }

    const updated = updatedRows?.[0] as any;
    return NextResponse.json(
      {
        ok: true,
        booking_id: updated?.id ?? booking.id,
        booking_code: updated?.booking_code ?? booking.booking_code,
        driver_id: updated?.driver_id ?? effectiveDriverId ?? null,
        assigned_driver_id: updated?.assigned_driver_id ?? effectiveDriverId ?? null,
        proposed_fare: updated?.proposed_fare ?? proposedFare,
        passenger_fare_response: updated?.passenger_fare_response ?? null,
        status: updated?.status ?? "fare_proposed",
        canonical_route: "driver/fare/propose",
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", message: String(e?.message ?? e) }, { status: 500 });
  }
}
'@

$fareOfferContent = @'
import { NextResponse } from "next/server";
import { POST as canonicalFareProposePost } from "@/app/api/driver/fare/propose/route";

export const dynamic = "force-dynamic";

type Body = {
  bookingId?: string | null;
  bookingCode?: string | null;
  driverId?: string | null;
  fare?: number | string | null;
  proposed_fare?: number | string | null;
};

function first(values: any[]): string {
  for (const value of values) {
    const s = String(value ?? "").trim();
    if (s) return s;
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const payload = {
      driver_id: first([body.driverId]),
      booking_id: first([body.bookingId]),
      booking_code: first([body.bookingCode]),
      proposed_fare: body.proposed_fare ?? body.fare,
    };

    const forwarded = new Request(req.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const response = await canonicalFareProposePost(forwarded);
    const data = await response.json().catch(() => ({}));

    return NextResponse.json(
      {
        ...data,
        compatibility_route: "driver/fare-offer",
        canonical_route: "driver/fare/propose",
      },
      { status: response.status }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "FARE_OFFER_FATAL", message: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
'@

$dispatchOfferContent = @'
import { NextResponse } from "next/server";
import { POST as canonicalFareProposePost } from "@/app/api/driver/fare/propose/route";

export const dynamic = "force-dynamic";

type Body = {
  bookingId?: string | null;
  bookingCode?: string | null;
  driverId?: string | null;
  fare?: number | string | null;
  convenienceFee?: number | string | null;
};

function pickString(values: any[]): string {
  for (const value of values) {
    const s = String(value ?? "").trim();
    if (s) return s;
  }
  return "";
}

function toNumber(value: any, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const bookingId = pickString([body.bookingId]);
    const bookingCode = pickString([body.bookingCode]);
    const driverId = pickString([body.driverId]);
    const baseFare = toNumber(body.fare, NaN);

    if (!driverId) {
      return NextResponse.json({ ok: false, code: "MISSING_DRIVER_ID" }, { status: 400 });
    }
    if (!bookingId && !bookingCode) {
      return NextResponse.json({ ok: false, code: "MISSING_BOOKING_IDENTIFIER" }, { status: 400 });
    }
    if (!Number.isFinite(baseFare) || baseFare <= 0) {
      return NextResponse.json({ ok: false, code: "INVALID_FARE" }, { status: 400 });
    }

    const convenienceFee = toNumber(body.convenienceFee, 15);
    const totalFare = Math.round((baseFare + convenienceFee) * 100) / 100;

    const forwarded = new Request(req.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        driver_id: driverId,
        booking_id: bookingId,
        booking_code: bookingCode,
        proposed_fare: totalFare,
      }),
    });

    const response = await canonicalFareProposePost(forwarded);
    const data = await response.json().catch(() => ({}));

    return NextResponse.json(
      {
        ...data,
        total_fare: totalFare,
        base_fare: baseFare,
        convenience_fee: convenienceFee,
        compatibility_route: "dispatch/fare/offer",
        canonical_route: "driver/fare/propose",
      },
      { status: response.status }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, code: "FARE_OFFER_FATAL", message: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
'@

$ridesFareContent = @'
import { NextRequest, NextResponse } from "next/server";
import { POST as canonicalFareProposePost } from "@/app/api/driver/fare/propose/route";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const bookingCode = String(body?.bookingCode ?? body?.booking_code ?? "").trim();
    const fare = Number(body?.fare ?? body?.proposed_fare);

    if (!bookingCode || !Number.isFinite(fare)) {
      return NextResponse.json(
        { ok: false, error: "MISSING_OR_INVALID_FIELDS" },
        { status: 400 }
      );
    }

    const forwarded = new Request(req.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        booking_code: bookingCode,
        proposed_fare: fare,
      }),
    });

    const response = await canonicalFareProposePost(forwarded);
    const data = await response.json().catch(() => ({}));

    return NextResponse.json(
      {
        ...data,
        compatibility_route: "rides/fare",
        canonical_route: "driver/fare/propose",
      },
      { status: response.status }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
'@

$passengerReadContent = @'
import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/utils/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getAdminClientOrNull() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Resp = {
  ok: boolean;
  code?: string;
  message?: string;
  signed_in?: boolean;
  booking?: any;
};

function json(status: number, body: Resp) {
  return NextResponse.json(body, { status });
}

const ACTIVE_STATUSES = [
  "pending",
  "searching",
  "requested",
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "enroute",
  "on_trip",
];

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const url = new URL(req.url);
    const bookingCode = String(url.searchParams.get("code") || "").trim();

    let booking: any = null;
    let error: any = null;
    let signedIn = false;

    if (bookingCode) {
      const res = await supabase
        .from("bookings")
        .select(
          [
            "id",
            "booking_code",
            "status",
            "driver_id",
            "assigned_driver_id",
            "created_at",
            "updated_at",
            "created_by_user_id",
            "proposed_fare",
            "passenger_fare_response",
          ].join(",")
        )
        .eq("booking_code", bookingCode)
        .maybeSingle();

      booking = res.data;
      error = res.error;
      signedIn = true;
    } else {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;

      if (!user) {
        return json(200, { ok: true, signed_in: false, booking: null });
      }

      signedIn = true;
      const res = await supabase
        .from("bookings")
        .select(
          [
            "id",
            "booking_code",
            "status",
            "driver_id",
            "assigned_driver_id",
            "created_at",
            "updated_at",
            "created_by_user_id",
            "proposed_fare",
            "passenger_fare_response",
          ].join(",")
        )
        .eq("created_by_user_id", user.id)
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      booking = res.data;
      error = res.error;
    }

    if (error) {
      return json(500, {
        ok: false,
        code: "DB_ERROR",
        message: String(error.message || error),
        signed_in: signedIn,
      });
    }

    if (!booking) {
      return json(404, {
        ok: false,
        code: "NOT_FOUND",
        message: "Booking not found",
        signed_in: signedIn,
      });
    }

    return json(200, {
      ok: true,
      signed_in: signedIn,
      booking,
    });
  } catch (e: any) {
    return json(500, {
      ok: false,
      code: "ERROR",
      message: String(e?.message || e),
      signed_in: true,
    });
  }
}
'@

Write-Utf8NoBom $files.Propose $proposeContent
Write-Utf8NoBom $files.FareOffer $fareOfferContent
Write-Utf8NoBom $files.DispatchOffer $dispatchOfferContent
Write-Utf8NoBom $files.RidesFare $ridesFareContent
Write-Utf8NoBom $files.PassengerRead $passengerReadContent

Write-Ok 'JRide backend alignment patch applied.'
Write-Info 'Changed ownership behavior:'
Write-Info ' - driver/fare/propose is now the single fare proposal writer.'
Write-Info ' - driver/fare-offer, dispatch/fare/offer, and rides/fare now forward into driver/fare/propose.'
Write-Info ' - public/passenger/booking now returns signed_in=false when no session exists.'
