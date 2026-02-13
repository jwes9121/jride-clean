# PATCH-JRIDE_PHASE6E_ASSIGN_LATLNG_AUTODETECT.ps1
# Fix auto-assign when driver_locations_latest uses latitude/longitude instead of lat/lng
# Updates:
# - app/api/dispatch/assign/route.ts
# - app/api/public/passenger/book/route.ts
# ASCII ONLY. Do not touch LiveTrips.

$ErrorActionPreference = "Stop"

function Timestamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
function EnsureDir($p) { if (!(Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null } }
function BackupFile($p) {
  if (Test-Path $p) {
    $bak = "$p.bak.$(Timestamp)"
    Copy-Item $p $bak -Force
    Write-Host "[OK] Backup: $bak"
  }
}
function WriteUtf8NoBom($path, $content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

$assignRoute = "app\api\dispatch\assign\route.ts"
$bookRoute   = "app\api\public\passenger\book\route.ts"

EnsureDir (Split-Path $assignRoute)
if (!(Test-Path $bookRoute)) { throw "Missing: $bookRoute" }

BackupFile $assignRoute
BackupFile $bookRoute

# -------------------------
# app/api/dispatch/assign/route.ts
# -------------------------
$assignTs = @'
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type AssignReq = {
  booking_id?: string | null;
  booking_code?: string | null;
  town?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
};

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const q = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(q)));
}

async function bestEffortUpdateBooking(
  supabase: ReturnType<typeof createClient>,
  bookingId: string,
  patch: Record<string, any>
) {
  const r = await supabase.from("bookings").update(patch).eq("id", bookingId).select("*").maybeSingle();
  if (r.error) return { ok: false, error: r.error.message, data: null as any };
  return { ok: true, error: null as any, data: r.data };
}

async function fetchBookingByIdOrCode(
  supabase: ReturnType<typeof createClient>,
  booking_id?: string | null,
  booking_code?: string | null
) {
  if (booking_id) {
    const r = await supabase.from("bookings").select("*").eq("id", booking_id).maybeSingle();
    return { data: r.data, error: r.error?.message || null };
  }
  if (booking_code) {
    const r = await supabase.from("bookings").select("*").eq("booking_code", booking_code).maybeSingle();
    return { data: r.data, error: r.error?.message || null };
  }
  return { data: null, error: "Missing booking_id or booking_code" };
}

async function fetchOnlineDriversNormalized(
  supabase: ReturnType<typeof createClient>,
  town: string
) {
  // Try schema A: lat/lng
  const a = await supabase
    .from("driver_locations_latest")
    .select("driver_id,lat,lng,status,town,updated_at")
    .eq("town", town)
    .eq("status", "online")
    .limit(200);

  if (!a.error) {
    const rows = Array.isArray(a.data) ? a.data : [];
    return {
      ok: true,
      note: "Using driver_locations_latest.lat/lng",
      rows: rows.map((r: any) => ({
        driver_id: r.driver_id,
        lat: r.lat,
        lng: r.lng,
      })),
    };
  }

  const msg = a.error.message || "";
  // If lat/lng missing, try schema B: latitude/longitude
  const b = await supabase
    .from("driver_locations_latest")
    .select("driver_id,latitude,longitude,status,town,updated_at")
    .eq("town", town)
    .eq("status", "online")
    .limit(200);

  if (!b.error) {
    const rows = Array.isArray(b.data) ? b.data : [];
    return {
      ok: true,
      note: "Using driver_locations_latest.latitude/longitude (fallback from lat/lng error: " + msg + ")",
      rows: rows.map((r: any) => ({
        driver_id: r.driver_id,
        lat: r.latitude,
        lng: r.longitude,
      })),
    };
  }

  return { ok: false, note: "driver_locations_latest query failed: " + (b.error.message || msg), rows: [] as any[] };
}

async function findNearestOnlineDriver(
  supabase: ReturnType<typeof createClient>,
  town: string,
  pickup_lat: number,
  pickup_lng: number
) {
  const res = await fetchOnlineDriversNormalized(supabase, town);
  if (!res.ok) return { driver_id: null as string | null, note: res.note };

  let best: { driver_id: string; km: number } | null = null;

  for (const row of res.rows) {
    const dId = String(row.driver_id || "");
    const lat = row.lat;
    const lng = row.lng;
    if (!dId) continue;
    if (typeof lat !== "number" || typeof lng !== "number") continue;

    const km = haversineKm(pickup_lat, pickup_lng, lat, lng);
    if (!best || km < best.km) best = { driver_id: dId, km };
  }

  if (!best) return { driver_id: null as string | null, note: res.note + " | No eligible online drivers (or missing coords)." };
  return { driver_id: best.driver_id, note: res.note + " | Nearest driver selected (km=" + best.km.toFixed(3) + ")." };
}

export async function POST(req: Request) {
  const supabase = createClient();
  const body = (await req.json().catch(() => ({}))) as AssignReq;

  const bookingRes = await fetchBookingByIdOrCode(supabase, body.booking_id ?? null, body.booking_code ?? null);
  if (!bookingRes.data) {
    return NextResponse.json(
      { ok: false, code: "BOOKING_NOT_FOUND", message: bookingRes.error || "Booking not found" },
      { status: 404 }
    );
  }

  const booking: any = bookingRes.data;

  const town = (body.town ?? booking.town ?? "").toString();
  const pickup_lat = typeof body.pickup_lat === "number" ? body.pickup_lat : booking.pickup_lat;
  const pickup_lng = typeof body.pickup_lng === "number" ? body.pickup_lng : booking.pickup_lng;

  if (!town) return NextResponse.json({ ok: false, code: "MISSING_TOWN", message: "Missing town for assignment" }, { status: 400 });
  if (typeof pickup_lat !== "number" || typeof pickup_lng !== "number") {
    return NextResponse.json({ ok: false, code: "MISSING_PICKUP_COORDS", message: "Missing pickup_lat/pickup_lng for assignment" }, { status: 400 });
  }

  const pick = await findNearestOnlineDriver(supabase, town, pickup_lat, pickup_lng);
  if (!pick.driver_id) {
    return NextResponse.json({ ok: false, code: "NO_DRIVER_AVAILABLE", message: "No available driver", note: pick.note }, { status: 409 });
  }

  const upd = await bestEffortUpdateBooking(supabase, String(booking.id), { driver_id: pick.driver_id, status: "assigned" });

  return NextResponse.json(
    {
      ok: true,
      assigned: true,
      booking_id: String(booking.id),
      booking_code: booking.booking_code ?? null,
      driver_id: pick.driver_id,
      note: pick.note,
      update_ok: upd.ok,
      update_error: upd.error,
      booking: upd.data ?? null,
    },
    { status: 200 }
  );
}
'@

# -------------------------
# app/api/public/passenger/book/route.ts
# Only change: driver_locations_latest query now auto-detects lat/lng vs latitude/longitude
# -------------------------
$bookTxt = Get-Content $bookRoute -Raw

# Quick safety: ensure file contains driver_locations_latest reference (Phase 6E)
if ($bookTxt -notmatch "driver_locations_latest") { throw "book route does not look like Phase 6E version (no driver_locations_latest found): $bookRoute" }

# Replace the findNearestOnlineDriver block by rewriting the whole file from your current Phase 6E baseline would be safest,
# but to keep minimal we will overwrite book route with the same Phase 6E content including the autodetect helper.

$bookTs = @'
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type BookReq = {
  passenger_name?: string | null;
  town?: string | null;

  from_label?: string | null;
  to_label?: string | null;

  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;

  service?: string | null;
};

function codeNow() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${y}${m}${day}${hh}${mm}${ss}`;
}

function rand4() {
  return Math.floor(Math.random() * 10000).toString().padStart(4, "0");
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const q = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(q)));
}

async function canBookOrThrow(supabase: ReturnType<typeof createClient>) {
  const out: any = { ok: true };

  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour12: false, hour: "2-digit" });
  const hour = parseInt(fmt.format(new Date()), 10);
  const nightGate = hour >= 20 || hour < 5;

  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;

  let verified = false;
  if (user) {
    const email = user.email ?? null;
    const userId = user.id;
    const selV = "is_verified,verified,verification_tier";

    const tries: Array<["auth_user_id" | "user_id" | "email", string | null]> = [
      ["auth_user_id", userId],
      ["user_id", userId],
      ["email", email],
    ];

    for (const [col, val] of tries) {
      if (!val) continue;
      const r = await supabase.from("passengers").select(selV).eq(col, val).limit(1).maybeSingle();
      if (!r.error && r.data) {
        const row: any = r.data;
        const truthy = (v: any) =>
          v === true ||
          (typeof v === "string" && v.trim().toLowerCase() !== "" && v.trim().toLowerCase() !== "false") ||
          (typeof v === "number" && v > 0);
        verified = truthy(row.is_verified) || truthy(row.verified) || truthy(row.verification_tier);
        break;
      }
    }
  }

  if (nightGate && !verified) {
    out.ok = false;
    out.status = 403;
    out.code = "NIGHT_GATE_UNVERIFIED";
    out.message = "Booking is restricted from 8PM to 5AM unless verified.";
    throw out;
  }

  if (user) {
    const email = user.email ?? null;
    const userId = user.id;
    const selW = "wallet_balance,min_wallet_required,wallet_locked";
    const tries: Array<["auth_user_id" | "user_id" | "email", string | null]> = [
      ["auth_user_id", userId],
      ["user_id", userId],
      ["email", email],
    ];

    for (const [col, val] of tries) {
      if (!val) continue;
      const r = await supabase.from("passengers").select(selW).eq(col, val).limit(1).maybeSingle();
      if (r.error) break; // fail-open
      if (r.data) {
        const row: any = r.data;
        const locked = row.wallet_locked === true;
        const bal = typeof row.wallet_balance === "number" ? row.wallet_balance : null;
        const min = typeof row.min_wallet_required === "number" ? row.min_wallet_required : null;

        if (locked) {
          out.ok = false;
          out.status = 402;
          out.code = "WALLET_LOCKED";
          out.message = "Wallet is locked.";
          throw out;
        }
        if (typeof bal === "number" && typeof min === "number" && bal < min) {
          out.ok = false;
          out.status = 402;
          out.code = "WALLET_INSUFFICIENT";
          out.message = "Insufficient wallet balance.";
          throw out;
        }
        break;
      }
    }
  }

  return true;
}

async function bestEffortUpdateBooking(
  supabase: ReturnType<typeof createClient>,
  bookingId: string,
  patch: Record<string, any>
) {
  const r = await supabase.from("bookings").update(patch).eq("id", bookingId).select("*").maybeSingle();
  if (r.error) return { ok: false, error: r.error.message, data: null as any };
  return { ok: true, error: null as any, data: r.data };
}

async function fetchOnlineDriversNormalized(
  supabase: ReturnType<typeof createClient>,
  town: string
) {
  const a = await supabase
    .from("driver_locations_latest")
    .select("driver_id,lat,lng,status,town,updated_at")
    .eq("town", town)
    .eq("status", "online")
    .limit(200);

  if (!a.error) {
    const rows = Array.isArray(a.data) ? a.data : [];
    return {
      ok: true,
      note: "Using driver_locations_latest.lat/lng",
      rows: rows.map((r: any) => ({ driver_id: r.driver_id, lat: r.lat, lng: r.lng })),
    };
  }

  const msg = a.error.message || "";
  const b = await supabase
    .from("driver_locations_latest")
    .select("driver_id,latitude,longitude,status,town,updated_at")
    .eq("town", town)
    .eq("status", "online")
    .limit(200);

  if (!b.error) {
    const rows = Array.isArray(b.data) ? b.data : [];
    return {
      ok: true,
      note: "Using driver_locations_latest.latitude/longitude (fallback from lat/lng error: " + msg + ")",
      rows: rows.map((r: any) => ({ driver_id: r.driver_id, lat: r.latitude, lng: r.longitude })),
    };
  }

  return { ok: false, note: "driver_locations_latest query failed: " + (b.error.message || msg), rows: [] as any[] };
}

async function findNearestOnlineDriver(
  supabase: ReturnType<typeof createClient>,
  town: string,
  pickup_lat: number,
  pickup_lng: number
) {
  const res = await fetchOnlineDriversNormalized(supabase, town);
  if (!res.ok) return { driver_id: null as string | null, note: res.note };

  let best: { driver_id: string; km: number } | null = null;

  for (const row of res.rows) {
    const dId = String(row.driver_id || "");
    const lat = row.lat;
    const lng = row.lng;
    if (!dId) continue;
    if (typeof lat !== "number" || typeof lng !== "number") continue;

    const km = haversineKm(pickup_lat, pickup_lng, lat, lng);
    if (!best || km < best.km) best = { driver_id: dId, km };
  }

  if (!best) return { driver_id: null as string | null, note: res.note + " | No eligible online drivers (or missing coords)." };
  return { driver_id: best.driver_id, note: res.note + " | Nearest driver selected (km=" + best.km.toFixed(3) + ")." };
}

export async function POST(req: Request) {
  const supabase = createClient();
  const body = (await req.json().catch(() => ({}))) as BookReq;

  try {
    await canBookOrThrow(supabase);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, code: e.code || "CAN_BOOK_FAILED", message: e.message || "Not allowed" },
      { status: e.status || 403 }
    );
  }

  const booking_code = `JR-UI-${codeNow()}-${rand4()}`;

  const payload: any = {
    booking_code,
    passenger_name: body.passenger_name ?? null,
    from_label: body.from_label ?? null,
    to_label: body.to_label ?? null,
    town: body.town ?? null,
    pickup_lat: body.pickup_lat ?? null,
    pickup_lng: body.pickup_lng ?? null,
    dropoff_lat: body.dropoff_lat ?? null,
    dropoff_lng: body.dropoff_lng ?? null,
    status: "requested",
  };

  const ins = await supabase.from("bookings").insert(payload).select("*").maybeSingle();

  if (ins.error) {
    const payload2: any = { ...payload };
    delete payload2.status;

    const ins2 = await supabase.from("bookings").insert(payload2).select("*").maybeSingle();
    if (ins2.error) {
      console.error("[passenger/book] insert error", ins2.error);
      return NextResponse.json({ ok: false, code: "BOOKING_INSERT_FAILED", message: ins2.error.message }, { status: 500 });
    }

    const booking: any = ins2.data;

    await bestEffortUpdateBooking(supabase, String(booking.id), { status: "requested" });

    const town = String(booking.town || body.town || "");
    const pLat = booking.pickup_lat;
    const pLng = booking.pickup_lng;

    let assign: any = { ok: false, note: "Assignment skipped." };
    if (town && typeof pLat === "number" && typeof pLng === "number") {
      const pick = await findNearestOnlineDriver(supabase, town, pLat, pLng);
      if (pick.driver_id) {
        const upd = await bestEffortUpdateBooking(supabase, String(booking.id), { driver_id: pick.driver_id, status: "assigned" });
        assign = { ok: true, driver_id: pick.driver_id, note: pick.note, update_ok: upd.ok, update_error: upd.error };
      } else {
        assign = { ok: false, note: pick.note };
      }
    }

    return NextResponse.json({ ok: true, booking_code, booking: booking ?? null, assign }, { status: 200 });
  }

  const booking: any = ins.data;

  const town = String(booking.town || body.town || "");
  const pLat = booking.pickup_lat;
  const pLng = booking.pickup_lng;

  let assign: any = { ok: false, note: "Assignment skipped." };
  if (town && typeof pLat === "number" && typeof pLng === "number") {
    const pick = await findNearestOnlineDriver(supabase, town, pLat, pLng);
    if (pick.driver_id) {
      const upd = await bestEffortUpdateBooking(supabase, String(booking.id), { driver_id: pick.driver_id, status: "assigned" });
      assign = { ok: true, driver_id: pick.driver_id, note: pick.note, update_ok: upd.ok, update_error: upd.error };
    } else {
      assign = { ok: false, note: pick.note };
    }
  }

  return NextResponse.json({ ok: true, booking_code, booking: booking ?? null, assign }, { status: 200 });
}
'@

WriteUtf8NoBom $assignRoute $assignTs
WriteUtf8NoBom $bookRoute $bookTs

Write-Host "[OK] Patched: $assignRoute"
Write-Host "[OK] Patched: $bookRoute"
Write-Host "[NEXT] Build: npm.cmd run build"
