import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type ProposeBody = {
  booking_code?: string;
  booking_id?: string;
  proposed_fare?: number | string | null;
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

    const bookingCode = text(body.booking_code);
    const bookingId = text(body.booking_id);
    const proposedFare = num(body.proposed_fare);

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

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHED", message: "Not signed in." },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    const driverId = userRes.user.id;

    let query = supabase
      .from("bookings")
      .select("*")
      .limit(1);

    if (bookingCode) {
      query = query.eq("booking_code", bookingCode);
    } else {
      query = query.eq("id", bookingId);
    }

    query = query.or(`assigned_driver_id.eq.${driverId},driver_id.eq.${driverId}`);

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

    if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
      return NextResponse.json(
        { ok: false, error: "MISSING_PICKUP_COORDS" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const effectiveDriverId =
      (booking as any).assigned_driver_id || (booking as any).driver_id || driverId;

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

    const updatePayload: Record<string, unknown> = {
      proposed_fare: proposedFare,
      passenger_fare_response: null,
      driver_to_pickup_km: driverToPickupKm,
      pickup_distance_fee: pickupFee,
      status: "fare_proposed",
    };

    if (!(booking as any).driver_id) {
      updatePayload.driver_id = effectiveDriverId;
    }
    if (!(booking as any).assigned_driver_id) {
      updatePayload.assigned_driver_id = effectiveDriverId;
    }

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

    const totalFare = proposedFare + pickupFee;

    return NextResponse.json(
      {
        ok: true,
        booking_code: (booking as any).booking_code,
        booking_id: (booking as any).id,
        status: "fare_proposed",
        proposed_fare: proposedFare,
        driver_to_pickup_km: driverToPickupKm,
        pickup_distance_fee: pickupFee,
        total_fare: totalFare,
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