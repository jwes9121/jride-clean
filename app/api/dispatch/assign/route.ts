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

function pickCoord(row: any) {
  const lat =
    typeof row.lat === "number" ? row.lat :
    typeof row.latitude === "number" ? row.latitude :
    typeof row.pickup_lat === "number" ? row.pickup_lat :
    null;

  const lng =
    typeof row.lng === "number" ? row.lng :
    typeof row.longitude === "number" ? row.longitude :
    typeof row.pickup_lng === "number" ? row.pickup_lng :
    null;

  return { lat, lng };
}

function pickTown(row: any) {
  const t =
    (row.town ?? row.zone ?? row.home_town ?? row.municipality ?? row.city ?? null);
  return t ? String(t) : null;
}

function pickOnline(row: any) {
  const v = row.status ?? row.driver_status ?? row.state ?? row.availability ?? null;
  if (v === null || v === undefined) return { hasField: false, isOnline: true, raw: null };
  const s = String(v).trim().toLowerCase();
  const online = s === "online" || s === "available" || s === "idle" || s === "active";
  const notOnline = s === "offline" || s === "on_trip" || s === "busy" || s === "assigned";
  return { hasField: true, isOnline: online && !notOnline, raw: s };
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

async function findNearestDriverSmart(
  supabase: ReturnType<typeof createClient>,
  town: string,
  pickup_lat: number,
  pickup_lng: number
) {
  const r = await supabase.from("driver_locations_latest").select("*").limit(500);
  if (r.error) return { driver_id: null as string | null, note: "driver_locations_latest query failed: " + r.error.message };

  const rows = Array.isArray(r.data) ? r.data : [];
  let best: { driver_id: string; km: number } | null = null;

  let usedTownField = false;
  let statusFieldSeen = false;

  for (const row of rows) {
    const dId = row.driver_id ? String(row.driver_id) : "";
    if (!dId) continue;

    const t = pickTown(row);
    if (t !== null) usedTownField = true;
    if (t !== null && t !== town) continue;

    const st = pickOnline(row);
    if (st.hasField) statusFieldSeen = true;
    if (st.hasField && !st.isOnline) continue;

    const c = pickCoord(row);
    if (typeof c.lat !== "number" || typeof c.lng !== "number") continue;

    const km = haversineKm(pickup_lat, pickup_lng, c.lat, c.lng);
    if (!best || km < best.km) best = { driver_id: dId, km };
  }

  if (!best) {
    let note = "No eligible drivers found.";
    if (!usedTownField) note += " (No town/zone field detected; could not filter by town.)";
    if (!statusFieldSeen) note += " (No status field detected; could not filter online only.)";
    return { driver_id: null as string | null, note };
  }

  let note = "Nearest driver selected (km=" + best.km.toFixed(3) + ").";
  if (!statusFieldSeen) note += " Note: no status field detected; selection may include offline drivers.";
  if (!usedTownField) note += " Note: no town field detected; selection not town-filtered.";
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

  const town = (body.town ?? booking.town ?? "").toString();
  const pickup_lat = typeof body.pickup_lat === "number" ? body.pickup_lat : booking.pickup_lat;
  const pickup_lng = typeof body.pickup_lng === "number" ? body.pickup_lng : booking.pickup_lng;

  if (!town) return NextResponse.json({ ok: false, code: "MISSING_TOWN", message: "Missing town for assignment" }, { status: 400 });
  if (typeof pickup_lat !== "number" || typeof pickup_lng !== "number") {
    return NextResponse.json({ ok: false, code: "MISSING_PICKUP_COORDS", message: "Missing pickup_lat/pickup_lng for assignment" }, { status: 400 });
  }

  const pick = await findNearestDriverSmart(supabase, town, pickup_lat, pickup_lng);
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