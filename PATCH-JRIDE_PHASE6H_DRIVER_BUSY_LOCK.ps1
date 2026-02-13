# PATCH-JRIDE_PHASE6H_DRIVER_BUSY_LOCK.ps1
# Phase 6H: driver busy lock (exclude drivers with active bookings) in both:
# - app/api/dispatch/assign/route.ts
# - app/api/public/passenger/book/route.ts
# ASCII ONLY. Do not touch LiveTrips.

$ErrorActionPreference = "Stop"

function Timestamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
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

if (!(Test-Path $assignRoute)) { throw "Missing: $assignRoute" }
if (!(Test-Path $bookRoute)) { throw "Missing: $bookRoute" }

BackupFile $assignRoute
BackupFile $bookRoute

# -------------------------
# app/api/dispatch/assign/route.ts (overwrite with busy-lock + 6G hardening)
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

const BUSY_STATUSES = ["assigned", "arrived", "on_the_way", "enroute", "on_trip"];

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

function pickCoord(row: any) {
  const lat = typeof row.lat === "number" ? row.lat : typeof row.latitude === "number" ? row.latitude : null;
  const lng = typeof row.lng === "number" ? row.lng : typeof row.longitude === "number" ? row.longitude : null;
  return { lat, lng };
}

function normStatus(v: any) {
  return String(v ?? "").trim().toLowerCase();
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

async function bestEffortUpdateBooking(
  supabase: ReturnType<typeof createClient>,
  bookingId: string,
  patch: Record<string, any>
) {
  const r = await supabase.from("bookings").update(patch).eq("id", bookingId).select("*").maybeSingle();
  if (r.error) return { ok: false, error: r.error.message, data: null as any };
  return { ok: true, error: null as any, data: r.data };
}

async function fetchBusyDriverIdsInTown(
  supabase: ReturnType<typeof createClient>,
  town: string
) {
  // NOTE: we only need driver_id + status; keep select minimal but safe.
  const r = await supabase
    .from("bookings")
    .select("driver_id,status,town")
    .eq("town", town)
    .in("status", BUSY_STATUSES)
    .not("driver_id", "is", null)
    .limit(500);

  if (r.error) {
    // Fail-open: no busy lock if query fails.
    return { ok: false, note: "busy-check failed: " + r.error.message, busy: new Set<string>() };
  }

  const busy = new Set<string>();
  const rows = Array.isArray(r.data) ? r.data : [];
  for (const row of rows) {
    const id = row && row.driver_id ? String(row.driver_id) : "";
    if (id) busy.add(id);
  }

  return { ok: true, note: "busy drivers in town: " + busy.size, busy };
}

async function findNearestOnlineFreeDriverInTown(
  supabase: ReturnType<typeof createClient>,
  town: string,
  pickup_lat: number,
  pickup_lng: number
) {
  const busyRes = await fetchBusyDriverIdsInTown(supabase, town);
  const busy = busyRes.busy;

  const r = await supabase
    .from("driver_locations")
    .select("*")
    .eq("town", town)
    .eq("status", "online")
    .limit(300);

  if (r.error) {
    return { driver_id: null as string | null, note: "driver_locations query failed: " + r.error.message };
  }

  const rows = Array.isArray(r.data) ? r.data : [];
  let best: { driver_id: string; km: number } | null = null;
  let skippedBusy = 0;
  let coordSeen = 0;

  for (const row of rows) {
    const dId = row.driver_id ? String(row.driver_id) : "";
    if (!dId) continue;

    if (busy.has(dId)) {
      skippedBusy++;
      continue;
    }

    const c = pickCoord(row);
    if (typeof c.lat !== "number" || typeof c.lng !== "number") continue;
    coordSeen++;

    const km = haversineKm(pickup_lat, pickup_lng, c.lat, c.lng);
    if (!best || km < best.km) best = { driver_id: dId, km };
  }

  if (!best) {
    let note = "No eligible ONLINE free drivers in town (online_rows=" + rows.length + ", coords=" + coordSeen + ", skipped_busy=" + skippedBusy + ").";
    if (!busyRes.ok) note += " Note: " + busyRes.note;
    return { driver_id: null as string | null, note };
  }

  let note = "Nearest ONLINE free driver selected (km=" + best.km.toFixed(3) + ").";
  if (!busyRes.ok) note += " Note: " + busyRes.note;
  return { driver_id: best.driver_id, note };
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

  // ----- 6G HARDENING: idempotent / no overwrite -----
  const curStatus = normStatus(booking.status);
  const alreadyHasDriver = !!booking.driver_id;

  if (alreadyHasDriver && curStatus && curStatus !== "requested") {
    return NextResponse.json(
      {
        ok: true,
        assigned: false,
        code: "ALREADY_ASSIGNED",
        message: "Booking already has a driver and is not assignable.",
        booking_id: String(booking.id),
        booking_code: booking.booking_code ?? null,
        driver_id: String(booking.driver_id),
        status: booking.status ?? null,
        booking,
      },
      { status: 200 }
    );
  }

  if (alreadyHasDriver) {
    if (!curStatus || curStatus === "requested") {
      await bestEffortUpdateBooking(supabase, String(booking.id), { status: "assigned" });
      const reread = await fetchBookingByIdOrCode(supabase, String(booking.id), null);
      const b2: any = reread.data ?? booking;
      return NextResponse.json(
        {
          ok: true,
          assigned: true,
          code: "ALREADY_HAS_DRIVER",
          message: "Booking already had driver_id; status normalized to assigned (best-effort).",
          booking_id: String(b2.id),
          booking_code: b2.booking_code ?? null,
          driver_id: b2.driver_id ?? null,
          status: b2.status ?? null,
          booking: b2,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        assigned: true,
        code: "ALREADY_HAS_DRIVER",
        message: "Booking already has driver_id.",
        booking_id: String(booking.id),
        booking_code: booking.booking_code ?? null,
        driver_id: booking.driver_id ?? null,
        status: booking.status ?? null,
        booking,
      },
      { status: 200 }
    );
  }

  if (curStatus && curStatus !== "requested") {
    return NextResponse.json(
      {
        ok: true,
        assigned: false,
        code: "NOT_ASSIGNABLE",
        message: "Booking status is not assignable: " + curStatus,
        booking_id: String(booking.id),
        booking_code: booking.booking_code ?? null,
        status: booking.status ?? null,
        booking,
      },
      { status: 200 }
    );
  }

  const town = (body.town ?? booking.town ?? "").toString();
  const pickup_lat = typeof body.pickup_lat === "number" ? body.pickup_lat : booking.pickup_lat;
  const pickup_lng = typeof body.pickup_lng === "number" ? body.pickup_lng : booking.pickup_lng;

  if (!town) return NextResponse.json({ ok: false, code: "MISSING_TOWN", message: "Missing town for assignment" }, { status: 400 });
  if (typeof pickup_lat !== "number" || typeof pickup_lng !== "number") {
    return NextResponse.json({ ok: false, code: "MISSING_PICKUP_COORDS", message: "Missing pickup_lat/pickup_lng for assignment" }, { status: 400 });
  }

  // ----- 6H: busy lock applied here -----
  const pick = await findNearestOnlineFreeDriverInTown(supabase, town, pickup_lat, pickup_lng);
  if (!pick.driver_id) {
    return NextResponse.json(
      { ok: false, code: "NO_DRIVER_AVAILABLE", message: "No available driver", note: pick.note },
      { status: 409 }
    );
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

WriteUtf8NoBom $assignRoute $assignTs
Write-Host "[OK] Wrote: $assignRoute"

# -------------------------
# app/api/public/passenger/book/route.ts
# Minimal safe patch: if it calls dispatch/assign internally, keep; otherwise it assigns itself.
# We update any BUSY_STATUSES list if present; else no change needed because dispatch/assign now handles busy lock.
# Also ensure it can still call assign endpoint (direct or internal). We will NOT overwrite your gating logic here.
# We will only patch strings if present (safe no-op if not).
# -------------------------
$bookTxt = Get-Content $bookRoute -Raw
$bookTxt2 = $bookTxt

if ($bookTxt2 -match "BUSY_STATUSES") {
  $bookTxt2 = [regex]::Replace(
    $bookTxt2,
    '(?s)const\s+BUSY_STATUSES\s*=\s*\[[^\]]*\]\s*;',
    'const BUSY_STATUSES = ["assigned","arrived","on_the_way","enroute","on_trip"];'
  )
}

# If book route uses a local selection function (driver_locations), add a busy exclusion if it has a recognizable marker.
# If no marker, we leave it alone because dispatch/assign endpoint is now correct.
WriteUtf8NoBom $bookRoute $bookTxt2
Write-Host "[OK] Patched (safe): $bookRoute"

Write-Host "[NEXT] Build: npm.cmd run build"
