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
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "null") return null;
  const n = Number(s);
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
  const blockKm = 0.5;
  const feePerBlock = 20;

  const chargeableKm = Math.max(0, km - freeKm);
  if (chargeableKm <= 0) return 0;

  const blocks = Math.ceil(chargeableKm / blockKm);
  return blocks * feePerBlock;
}

function estimateEtaMinutes(distanceKm: number | null): number | null {
  if (distanceKm == null || distanceKm <= 0) return null;
  return Math.max(1, Math.ceil((distanceKm / 25) * 60));
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
        { ok: false, error: "NOT_AUTHED", message: "Missing driver identity." },
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

    if (bookingErr) {
      return NextResponse.json(
        {
          ok: false,
          error: "BOOKING_READ_FAILED",
          message: bookingErr.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const booking = rows?.[0] ?? null;

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_NOT_FOUND" },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    const assignedDriverId = text((booking as any).assigned_driver_id);
    const bookingDriverId = text((booking as any).driver_id);

    if (
      effectiveDriverId !== assignedDriverId &&
      effectiveDriverId !== bookingDriverId
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "DRIVER_NOT_ASSIGNED",
          assigned_driver_id: assignedDriverId || null,
          driver_id: bookingDriverId || null,
          effective_driver_id: effectiveDriverId || null,
        },
        { status: 403, headers: noStoreHeaders() }
      );
    }

    const currentStatus = text((booking as any).status).toLowerCase();
    if (!["assigned", "accepted"].includes(currentStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_STATUS",
          message: "Fare can only be proposed from assigned or accepted state.",
          status: currentStatus,
        },
        { status: 409, headers: noStoreHeaders() }
      );
    }

    const pickupLat = Number((booking as any).pickup_lat ?? NaN);
    const pickupLng = Number((booking as any).pickup_lng ?? NaN);
    const dropoffLat = Number((booking as any).dropoff_lat ?? NaN);
    const dropoffLng = Number((booking as any).dropoff_lng ?? NaN);

    if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
      return NextResponse.json(
        { ok: false, error: "MISSING_PICKUP_COORDS" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    let driverLat: number | null = null;
    let driverLng: number | null = null;

    const { data: driverLoc } = await supabase
      .from("driver_locations_latest")
      .select("lat,lng")
      .eq("driver_id", effectiveDriverId)
      .maybeSingle();

    if (driverLoc) {
      const lat = Number((driverLoc as any).lat ?? NaN);
      const lng = Number((driverLoc as any).lng ?? NaN);
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

    let tripDistanceKm: number | null = null;
    if (
      Number.isFinite(pickupLat) &&
      Number.isFinite(pickupLng) &&
      Number.isFinite(dropoffLat) &&
      Number.isFinite(dropoffLng)
    ) {
      tripDistanceKm = Number(
        haversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng).toFixed(2)
      );
    }

    const etaMinutes = estimateEtaMinutes(driverToPickupKm);

    const updatePayload: Record<string, unknown> = {
      proposed_fare: proposedFare,
      verified_fare: null,
      passenger_fare_response: null,
      driver_to_pickup_km: driverToPickupKm,
      pickup_distance_fee: pickupFee,
      trip_distance_km: tripDistanceKm,
      status: "fare_proposed",
      assigned_driver_id: assignedDriverId || effectiveDriverId,
      driver_id: bookingDriverId || effectiveDriverId,
    };

    const { error: updateErr } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", (booking as any).id);

    if (updateErr) {
      return NextResponse.json(
        {
          ok: false,
          error: "FARE_PROPOSE_UPDATE_FAILED",
          message: updateErr.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const { data: freshRows, error: freshErr } = await supabase
      .from("bookings")
      .select(
        "id, booking_code, status, proposed_fare, verified_fare, passenger_fare_response, driver_to_pickup_km, pickup_distance_fee, trip_distance_km"
      )
      .eq("id", (booking as any).id)
      .limit(1);

    const fresh = freshRows?.[0] ?? null;

    if (freshErr || !fresh) {
      return NextResponse.json(
        {
          ok: true,
          booking_code: (booking as any).booking_code,
          booking_id: (booking as any).id,
          status: "fare_proposed",
          proposed_fare: proposedFare,
          verified_fare: null,
          passenger_fare_response: null,
          driver_to_pickup_km: driverToPickupKm,
          pickup_eta_minutes: etaMinutes,
          pickup_distance_fee: pickupFee,
          trip_distance_km: tripDistanceKm,
          total_fare: proposedFare + pickupFee,
          reread_warning: freshErr?.message || "REREAD_NOT_AVAILABLE",
        },
        { status: 200, headers: noStoreHeaders() }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        booking_code: (fresh as any).booking_code,
        booking_id: (fresh as any).id,
        status: (fresh as any).status,
        proposed_fare: num((fresh as any).proposed_fare),
        verified_fare: num((fresh as any).verified_fare),
        passenger_fare_response: text((fresh as any).passenger_fare_response) || null,
        driver_to_pickup_km: num((fresh as any).driver_to_pickup_km),
        pickup_eta_minutes: etaMinutes,
        pickup_distance_fee: num((fresh as any).pickup_distance_fee) ?? 0,
        trip_distance_km: num((fresh as any).trip_distance_km),
        total_fare:
          (num((fresh as any).proposed_fare) ?? 0) +
          (num((fresh as any).pickup_distance_fee) ?? 0),
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: String(e?.message ?? e),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
