param(
  [Parameter(Mandatory=$true)][string]$RepoRoot
)

$ErrorActionPreference = "Stop"

function Write-Utf8NoBom {
  param([string]$Path,[string]$Content)
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $enc)
}

function Backup-File {
  param([string]$Path,[string]$Tag)
  $bakDir = Join-Path (Split-Path -Parent $Path) "_patch_bak"
  if (-not (Test-Path $bakDir)) {
    New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
  }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = Join-Path $bakDir ((Split-Path -Leaf $Path) + ".bak." + $Tag + "." + $stamp)
  Copy-Item $Path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

$RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)

$files = @(
  (Join-Path $RepoRoot "app\api\driver\fare-offer\route.ts"),
  (Join-Path $RepoRoot "app\api\dispatch\fare\offer\route.ts"),
  (Join-Path $RepoRoot "app\api\rides\fare\route.ts"),
  (Join-Path $RepoRoot "app\api\passenger\fare-response\route.ts"),
  (Join-Path $RepoRoot "app\api\rides\fare-response\route.ts")
)

foreach ($f in $files) {
  if (-not (Test-Path $f)) { throw "Missing file: $f" }
  Backup-File -Path $f -Tag "BACKEND_FARE_FLOW_NORMALIZE_V1"
}

# 1) driver/fare-offer
$path1 = Join-Path $RepoRoot "app\api\driver\fare-offer\route.ts"
$content1 = @'
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());
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

    const supabase = supabaseAdmin();

    let q = supabase.from("bookings").update({
      proposed_fare,
      status: "fare_proposed",
      driver_id,
      assigned_driver_id: driver_id,
      updated_at: new Date().toISOString(),
    });

    q = booking_id ? q.eq("id", booking_id) : q.eq("booking_code", booking_code);

    const { data, error } = await q
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
Write-Utf8NoBom -Path $path1 -Content $content1
Write-Host "[OK] Rewrote $path1"

# 2) dispatch/fare/offer
$path2 = Join-Path $RepoRoot "app\api\dispatch\fare\offer\route.ts"
$content2 = @'
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Body = {
  bookingId?: string | null;
  bookingCode?: string | null;
  driverId?: string | null;
  fare?: number | string | null;
  convenienceFee?: number | string | null;
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

    let q = supabase.from("bookings").update({
      proposed_fare: total,
      passenger_fare_response: null,
      driver_id: driverId,
      assigned_driver_id: driverId,
      assigned_at: new Date().toISOString(),
      status: "fare_proposed",
      updated_at: new Date().toISOString(),
    });

    q = bookingId ? q.eq("id", bookingId) : q.eq("booking_code", bookingCode);

    const { data, error } = await q
      .select("id, booking_code, status, proposed_fare, verified_fare, passenger_fare_response, driver_id, assigned_driver_id, updated_at")
      .limit(1);

    if (error) {
      return NextResponse.json({ ok: false, code: "FARE_OFFER_DB_ERROR", message: error.message }, { status: 500 });
    }

    const row = Array.isArray(data) && data.length ? data[0] : null;
    return NextResponse.json({ ok: true, booking: row, total_fare: total, base_fare: baseFare, convenience_fee: conv });
  } catch (e: any) {
    return NextResponse.json({ ok: false, code: "FARE_OFFER_FATAL", message: String(e?.message ?? e) }, { status: 500 });
  }
}
'@
Write-Utf8NoBom -Path $path2 -Content $content2
Write-Host "[OK] Rewrote $path2"

# 3) rides/fare
$path3 = Join-Path $RepoRoot "app\api\rides\fare\route.ts"
$content3 = @'
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const bookingCode: string | undefined = body?.bookingCode;
    const fare: number | undefined = body?.fare;

    if (!bookingCode || typeof fare !== "number") {
      return NextResponse.json(
        { ok: false, error: "MISSING_OR_INVALID_FIELDS" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("bookings")
      .update({
        proposed_fare: fare,
        status: "fare_proposed",
        updated_at: new Date().toISOString(),
      })
      .eq("booking_code", bookingCode)
      .select("*")
      .single();

    if (error) {
      console.error("FARE_UPDATE_ERROR", error);
      return NextResponse.json(
        { ok: false, error: "DB_ERROR_UPDATE", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, booking: data });
  } catch (err: any) {
    console.error("FARE_ROUTE_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
'@
Write-Utf8NoBom -Path $path3 -Content $content3
Write-Host "[OK] Rewrote $path3"

# 4) passenger/fare-response
$path4 = Join-Path $RepoRoot "app\api\passenger\fare-response\route.ts"
$content4 = @'
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const booking_id = String(body?.booking_id || "").trim();
    const booking_code = String(body?.booking_code || "").trim();
    const raw = String(body?.response || "").trim().toLowerCase();

    if ((!booking_id || !isUuidLike(booking_id)) && !booking_code) {
      return NextResponse.json({ ok: false, code: "MISSING_BOOKING" }, { status: 400 });
    }

    const response =
      raw === "accepted" ? "accepted" :
      (raw === "declined" || raw === "rejected") ? "rejected" :
      "";

    if (!response) {
      return NextResponse.json({ ok: false, code: "INVALID_RESPONSE" }, { status: 400 });
    }

    const supabase = supabaseAdmin();

    const patch =
      response === "accepted"
        ? {
            passenger_fare_response: "accepted",
            status: "ready",
            driver_status: "ready",
            customer_status: "ready",
            updated_at: new Date().toISOString(),
          }
        : {
            passenger_fare_response: "rejected",
            status: "pending",
            driver_id: null,
            assigned_driver_id: null,
            assigned_at: null,
            proposed_fare: null,
            verified_fare: null,
            verified_by: null,
            verified_at: null,
            verified_reason: null,
            updated_at: new Date().toISOString(),
          };

    let q = supabase.from("bookings").update(patch);
    q = booking_id ? q.eq("id", booking_id) : q.eq("booking_code", booking_code);

    const { data, error } = await q
      .select("id, booking_code, status, proposed_fare, verified_fare, passenger_fare_response, driver_id, assigned_driver_id, updated_at")
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
Write-Utf8NoBom -Path $path4 -Content $content4
Write-Host "[OK] Rewrote $path4"

# 5) rides/fare-response
$path5 = Join-Path $RepoRoot "app\api\rides\fare-response\route.ts"
$content5 = @'
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const sa = supabaseAdmin();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const bookingCode: string | undefined = body?.bookingCode;
    const response: "accepted" | "rejected" | undefined = body?.response;

    if (!bookingCode || !response) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    if (response !== "accepted" && response !== "rejected") {
      return NextResponse.json({ ok: false, error: "INVALID_RESPONSE" }, { status: 400 });
    }

    const updates: Record<string, any> =
      response === "accepted"
        ? {
            passenger_fare_response: "accepted",
            status: "ready",
            driver_status: "ready",
            customer_status: "ready",
            updated_at: new Date().toISOString(),
          }
        : {
            passenger_fare_response: "rejected",
            status: "pending",
            driver_id: null,
            assigned_driver_id: null,
            assigned_at: null,
            proposed_fare: null,
            verified_fare: null,
            verified_by: null,
            verified_at: null,
            verified_reason: null,
            updated_at: new Date().toISOString(),
          };

    const { data, error } = await sa.from("bookings")
      .update(updates)
      .eq("booking_code", bookingCode)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("FARE_RESPONSE_UPDATE_ERROR", error);
      return NextResponse.json(
        { ok: false, error: "DB_ERROR_UPDATE", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, booking: data });
  } catch (err: any) {
    console.error("FARE_RESPONSE_ROUTE_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
'@
Write-Utf8NoBom -Path $path5 -Content $content5
Write-Host "[OK] Rewrote $path5"

Write-Host ""
Write-Host "DONE: Backend fare-flow normalization patch applied."