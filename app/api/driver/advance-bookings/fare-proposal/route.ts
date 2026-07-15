import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  resolveAuthenticatedDriver,
  noStoreHeaders,
} from "@/lib/advance-booking/driverAuth";
import {
  PASSENGER_RESPONSE_MIN_LEAD_SECONDS,
  PASSENGER_RESPONSE_TIMEOUT_SECONDS,
} from "@/lib/advance-booking/constants";
import { pickupDistanceKm } from "@/lib/advance-booking/distance";
import { computeFare } from "@/lib/advance-booking/pricing";
import type {
  DepartureOption,
  VehicleType,
} from "@/lib/advance-booking/types";

export const dynamic = "force-dynamic";

function numberOrNaN(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return Number.NaN;
}

function validCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export async function POST(req: NextRequest) {
  const auth = await resolveAuthenticatedDriver(req);

  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: noStoreHeaders() }
    );
  }

  const body = await req.json().catch(() => ({}));
  const queueEntryId = String(body?.queueEntryId ?? "").trim();
  const departureOption = String(body?.departureOption ?? "").trim() as DepartureOption;

  if (!queueEntryId) {
    return NextResponse.json(
      { ok: false, error: "MISSING_QUEUE_ENTRY_ID", message: "Queue entry id is required." },
      { status: 400, headers: noStoreHeaders() }
    );
  }

  if (!["current_gps", "home", "other"].includes(departureOption)) {
    return NextResponse.json(
      { ok: false, error: "INVALID_DEPARTURE_OPTION", message: "Departure option is invalid." },
      { status: 400, headers: noStoreHeaders() }
    );
  }

  const supabase = supabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data: queueRow, error: queueError } = await supabase
    .from("advance_booking_queue")
    .select("id, advance_booking_id, status, fare_preparation_expires_at")
    .eq("id", queueEntryId)
    .eq("driver_id", auth.driverId)
    .eq("status", "tentative_committed")
    .gt("fare_preparation_expires_at", nowIso)
    .maybeSingle();

  if (queueError) {
    return NextResponse.json(
      { ok: false, error: queueError.message },
      { status: 500, headers: noStoreHeaders() }
    );
  }

  const queue = queueRow as any;
  if (!queue) {
    return NextResponse.json(
      { ok: false, error: "ACTIVE_CLAIM_NOT_FOUND", message: "Active advance booking claim was not found or has expired." },
      { status: 409, headers: noStoreHeaders() }
    );
  }

  const { data: bookingRow, error: bookingError } = await supabase
    .from("advance_bookings")
    .select("id, pickup_lat, pickup_lng, distance_km, scheduled_pickup_at, vehicle_type, status, current_offer_queue_id")
    .eq("id", queue.advance_booking_id)
    .eq("status", "open")
    .eq("current_offer_queue_id", queueEntryId)
    .maybeSingle();

  if (bookingError) {
    return NextResponse.json(
      { ok: false, error: bookingError.message },
      { status: 500, headers: noStoreHeaders() }
    );
  }

  const booking = bookingRow as any;
  if (!booking) {
    return NextResponse.json(
      { ok: false, error: "BOOKING_NOT_OPEN", message: "Advance booking is no longer open for a fare proposal." },
      { status: 409, headers: noStoreHeaders() }
    );
  }

  let departureLat: number;
  let departureLng: number;

  if (departureOption === "home") {
    const { data: homeRow, error: homeError } = await supabase
      .from("driver_home_locations")
      .select("home_lat, home_lng")
      .eq("driver_id", auth.driverId)
      .maybeSingle();

    if (homeError) {
      return NextResponse.json(
        { ok: false, error: homeError.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    if (!homeRow) {
      return NextResponse.json(
        { ok: false, error: "HOME_LOCATION_NOT_SET", message: "Home location is not set for this driver." },
        { status: 409, headers: noStoreHeaders() }
      );
    }

    departureLat = Number((homeRow as any).home_lat);
    departureLng = Number((homeRow as any).home_lng);
  } else {
    departureLat = numberOrNaN(body?.departureLat);
    departureLng = numberOrNaN(body?.departureLng);
  }

  if (!validCoordinate(departureLat, departureLng)) {
    return NextResponse.json(
      { ok: false, error: "INVALID_DEPARTURE_COORDINATES", message: "Departure coordinates are invalid." },
      { status: 400, headers: noStoreHeaders() }
    );
  }

  const pickupLat = Number(booking.pickup_lat);
  const pickupLng = Number(booking.pickup_lng);
  const tripDistance = Number(booking.distance_km);
  const scheduledPickupAt = new Date(booking.scheduled_pickup_at);
  const vehicleType = String(booking.vehicle_type || "") as VehicleType;

  if (!validCoordinate(pickupLat, pickupLng) ||
      !Number.isFinite(tripDistance) || tripDistance < 0 ||
      Number.isNaN(scheduledPickupAt.getTime()) ||
      !["tricycle", "motorcycle"].includes(vehicleType)) {
    return NextResponse.json(
      { ok: false, error: "INVALID_BOOKING_DATA", message: "Advance booking has invalid fare calculation data." },
      { status: 500, headers: noStoreHeaders() }
    );
  }

  const departureDistance = pickupDistanceKm(
    departureLat, departureLng, pickupLat, pickupLng
  );

  const pricing = computeFare({
    tripDistanceKm: tripDistance,
    pickupDistanceKm: departureDistance,
    scheduledPickupAt,
  });

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "submit_advance_booking_fare_proposal",
    {
      p_queue_entry_id: queueEntryId,
      p_driver_id: auth.driverId,
      p_departure_option: departureOption,
      p_departure_lat: departureLat,
      p_departure_lng: departureLng,
      p_departure_distance_km: pricing.pickupDistanceKm,
      p_pickup_fee: pricing.pickupFee,
      p_ride_fare: pricing.rideFare,
      p_night_premium: pricing.nightPremium,
      p_platform_fee: pricing.platformFee,
      p_total_fare: pricing.total,
      p_passenger_response_seconds: PASSENGER_RESPONSE_TIMEOUT_SECONDS,
      p_minimum_lead_seconds: PASSENGER_RESPONSE_MIN_LEAD_SECONDS,
    }
  );

  if (rpcError) {
    console.error("[advance-booking:fare-proposal:rpc]", rpcError);
    return NextResponse.json(
      { ok: false, error: "RPC_FAILED", message: rpcError.message },
      { status: 500, headers: noStoreHeaders() }
    );
  }

  const result = rpcData as any;

  if (!result?.ok) {
    const status =
      result?.error === "CLAIM_NOT_FOUND" || result?.error === "BOOKING_NOT_FOUND" ? 404 :
      result?.error === "FARE_PREPARATION_EXPIRED" ? 410 :
      ["CLAIM_NOT_ACTIVE", "CLAIM_NOT_CURRENT", "BOOKING_NOT_OPEN", "PASSENGER_RESPONSE_WINDOW_CLOSED"].includes(result?.error) ? 409 :
      result?.error === "INTERNAL_ERROR" ? 500 : 400;

    return NextResponse.json(
      { ok: false, error: result?.error || "FARE_PROPOSAL_FAILED", message: result?.message || "Advance booking fare proposal failed." },
      { status, headers: noStoreHeaders() }
    );
  }

  return NextResponse.json(result, { headers: noStoreHeaders() });
}
