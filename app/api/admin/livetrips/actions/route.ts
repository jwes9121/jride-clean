import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type ActionName = "NUDGE_DRIVER" | "REASSIGN_DRIVER" | "AUTO_ASSIGN";

function num(v: any): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickLatLng(row: any): { lat: number | null; lng: number | null } {
  const lat =
    num(row?.pickup_lat) ??
    num(row?.pickupLatitude) ??
    num(row?.pickup_latitude) ??
    null;
  const lng =
    num(row?.pickup_lng) ??
    num(row?.pickupLongitude) ??
    num(row?.pickup_longitude) ??
    null;
  return { lat, lng };
}

function dist2(aLat: number, aLng: number, bLat: number, bLng: number) {
  const dLat = aLat - bLat;
  const dLng = aLng - bLng;
  return dLat * dLat + dLng * dLng;
}

export async function POST(req: Request) {
  const supabase = createClient();

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, code: "BAD_JSON" }, { status: 400 });
  }

  const action = String(body?.action || "").toUpperCase() as ActionName;
  const booking_code = body?.booking_code ? String(body.booking_code) : null;
  const trip_id = body?.trip_id ? String(body.trip_id) : null;

  if (!action || !["NUDGE_DRIVER", "REASSIGN_DRIVER", "AUTO_ASSIGN"].includes(action)) {
    return NextResponse.json({ ok: false, code: "BAD_ACTION", action }, { status: 400 });
  }
  if (!booking_code && !trip_id) {
    return NextResponse.json({ ok: false, code: "MISSING_ID" }, { status: 400 });
  }

  // Load booking row (schema-safe: we inspect returned keys)
  const bookingQuery = supabase.from("bookings").select("*").limit(1);
  const bookingRes = booking_code
    ? await bookingQuery.eq("booking_code", booking_code).maybeSingle()
    : await bookingQuery.eq("id", trip_id).maybeSingle();

  if (bookingRes.error) {
    return NextResponse.json({ ok: false, code: "BOOKING_LOAD_ERROR", error: bookingRes.error.message }, { status: 500 });
  }
  const b = bookingRes.data;
  if (!b) {
    return NextResponse.json({ ok: false, code: "BOOKING_NOT_FOUND", booking_code, trip_id }, { status: 404 });
  }

  const can = (k: string) => Object.prototype.hasOwnProperty.call(b, k);

  const patch: Record<string, any> = {};
  // always bump updated_at if it exists
  if (can("updated_at")) patch.updated_at = new Date().toISOString();

  if (action === "NUDGE_DRIVER") {
    // Non-destructive: just bump updated_at so stale watchers can clear when driver is actually active
    return NextResponse.json({ ok: true, action, booking_code: b.booking_code ?? booking_code, patched: patch });
  }

  if (action === "REASSIGN_DRIVER") {
    // Clear driver link + reset status to assigned
    if (can("assigned_driver_id")) patch.assigned_driver_id = null;
    if (can("driver_id")) patch.driver_id = null;

    if (can("status")) patch.status = "assigned";

    const upd = await supabase.from("bookings").update(patch).eq("id", b.id).select("*").maybeSingle();
    if (upd.error) {
      return NextResponse.json({ ok: false, code: "UPDATE_FAILED", error: upd.error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, action, booking_code: upd.data?.booking_code ?? b.booking_code, booking: upd.data });
  }

  if (action === "AUTO_ASSIGN") {
    // Requires pickup coords
    const { lat, lng } = pickLatLng(b);
    if (lat == null || lng == null) {
      return NextResponse.json({ ok: false, code: "MISSING_PICKUP_COORDS" }, { status: 400 });
    }

    // Load driver locations (we do best-effort column usage)
    const dl = await supabase.from("driver_locations").select("*").limit(500);
    if (dl.error) {
      return NextResponse.json({ ok: false, code: "DRIVER_LOCATIONS_ERROR", error: dl.error.message }, { status: 500 });
    }

    const rows = Array.isArray(dl.data) ? dl.data : [];
    let best: any = null;
    let bestD = Infinity;

    for (const r of rows) {
      const did = r?.driver_id ?? r?.id ?? null;
      const rlat = num(r?.lat) ?? num(r?.latitude) ?? num(r?.driver_lat) ?? null;
      const rlng = num(r?.lng) ?? num(r?.longitude) ?? num(r?.driver_lng) ?? null;
      if (!did || rlat == null || rlng == null) continue;

      const d = dist2(lat, lng, rlat, rlng);
      if (d < bestD) {
        bestD = d;
        best = { driver_id: did, lat: rlat, lng: rlng };
      }
    }

    if (!best) {
      return NextResponse.json({ ok: false, code: "NO_DRIVER_CANDIDATES" }, { status: 404 });
    }

    // Apply assignment (use whichever column exists)
    if (can("assigned_driver_id")) patch.assigned_driver_id = best.driver_id;
    else if (can("driver_id")) patch.driver_id = best.driver_id;

    // Ensure status assigned
    if (can("status")) patch.status = "assigned";

    const upd = await supabase.from("bookings").update(patch).eq("id", b.id).select("*").maybeSingle();
    if (upd.error) {
      return NextResponse.json({ ok: false, code: "ASSIGN_FAILED", error: upd.error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      action,
      booking_code: upd.data?.booking_code ?? b.booking_code,
      assigned_driver_id: upd.data?.assigned_driver_id ?? null,
      driver_id: upd.data?.driver_id ?? null,
      booking: upd.data,
    });
  }

  return NextResponse.json({ ok: false, code: "UNREACHABLE" }, { status: 500 });
}