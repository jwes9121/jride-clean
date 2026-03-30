import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type ProposeBody = {
  booking_code?: string;
  bookingCode?: string;
  booking_id?: string;
  bookingId?: string;
  proposed_fare?: number | string | null;
  fare?: number | string | null;
  driver_id?: string;
  driverId?: string;
  user_id?: string;
  userId?: string;
};

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

function pickupDistanceFee(km: number): number {
  const freeKm = 1.5;
  const chargeable = Math.max(0, km - freeKm);
  return Math.round(chargeable * 20);
}

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const body = (await req.json().catch(() => ({}))) as ProposeBody;

    const bookingCode = text(body.booking_code || body.bookingCode);
    const bookingId = text(body.booking_id || body.bookingId);
    const proposedFare = num(body.proposed_fare ?? body.fare);

    if (!bookingCode && !bookingId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING_CODE" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    if (proposedFare == null || proposedFare <= 0) {
      return NextResponse.json(
        { ok: false, error: "INVALID_PROPOSED_FARE" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    let effectiveDriverId = text(
      body.driver_id || body.driverId || body.user_id || body.userId
    );

    if (!effectiveDriverId) {
      const { data: userRes } = await supabase.auth.getUser();
      if (userRes?.user?.id) {
        effectiveDriverId = userRes.user.id;
      }
    }

    if (!effectiveDriverId) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHED" },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    let query = supabase.from("bookings").select("*").limit(1);

    if (bookingCode) {
      query = query.eq("booking_code", bookingCode);
    } else {
      query = query.eq("id", bookingId);
    }

    const { data: rows, error: bookingErr } = await query;

    if (bookingErr || !rows?.length) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_NOT_FOUND" },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    const booking = rows[0];

    const pickupLat = Number(booking.pickup_lat ?? NaN);
    const pickupLng = Number(booking.pickup_lng ?? NaN);

    let driverLat: number | null = null;
    let driverLng: number | null = null;

    const { data: driverLoc } = await supabase
      .from("driver_locations_latest")
      .select("lat,lng")
      .eq("driver_id", effectiveDriverId)
      .maybeSingle();

    if (driverLoc) {
      const lat = Number(driverLoc.lat ?? NaN);
      const lng = Number(driverLoc.lng ?? NaN);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        driverLat = lat;
        driverLng = lng;
      }
    }

    let driverToPickupKm: number | null = null;
    let pickupFee = 0;

    if (driverLat != null && driverLng != null) {
      driverToPickupKm = Number(
        haversineKm(driverLat, driverLng, pickupLat, pickupLng).toFixed(1)
      );
      pickupFee = pickupDistanceFee(driverToPickupKm);
    }

    const totalFare = proposedFare + pickupFee;

    const updatePayload = {
      proposed_fare: proposedFare,
      verified_fare: null,
      passenger_fare_response: null,
      driver_to_pickup_km: driverToPickupKm,
      pickup_distance_fee: pickupFee,
      total_fare: totalFare,
      status: "fare_proposed",
    };

    const { error: updateErr } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", booking.id);

    if (updateErr) {
      return NextResponse.json(
        { ok: false, error: "UPDATE_FAILED", message: updateErr.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    // 🔥 CRITICAL: RE-READ AFTER UPDATE
    const { data: fresh } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", booking.id)
      .single();

    return NextResponse.json(
      {
        ok: true,
        booking_code: fresh.booking_code,
        status: fresh.status,
        proposed_fare: fresh.proposed_fare,
        pickup_distance_fee: fresh.pickup_distance_fee,
        total_fare: fresh.total_fare,
        driver_to_pickup_km: fresh.driver_to_pickup_km,
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}