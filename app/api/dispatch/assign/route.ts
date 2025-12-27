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