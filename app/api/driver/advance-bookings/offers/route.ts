import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  resolveAuthenticatedDriver,
  noStoreHeaders,
} from "@/lib/advance-booking/driverAuth";
import { offerAdvanceBooking } from "@/lib/advance-booking/offer";
import type { VehicleType } from "@/lib/advance-booking/types";

function secondsRemaining(expiresAt: string | null): number {
  if (!expiresAt) return 0;
  const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
  return diff > 0 ? diff : 0;
}


async function releaseAndReofferExpiredClaim(
  driverId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = supabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data: expiredRows, error: expiredError } = await supabase
    .from("advance_booking_queue")
    .select("id")
    .eq("driver_id", driverId)
    .eq("status", "tentative_committed")
    .lte("fare_preparation_expires_at", nowIso)
    .order("fare_preparation_expires_at", { ascending: true })
    .limit(1);

  if (expiredError) {
    return { ok: false, error: expiredError.message };
  }

  const expiredQueueId = String((expiredRows?.[0] as any)?.id || "");
  if (!expiredQueueId) {
    return { ok: true };
  }

  const { data: releaseData, error: releaseError } = await supabase.rpc(
    "release_expired_advance_booking_claim",
    {
      p_queue_entry_id: expiredQueueId,
      p_driver_id: driverId,
    }
  );

  if (releaseError) {
    return { ok: false, error: releaseError.message };
  }

  const releaseResult = releaseData as
    | {
        ok?: boolean;
        released?: boolean;
        advanceBookingId?: string;
        expiredDriverId?: string;
        error?: string;
        message?: string;
      }
    | null;

  if (!releaseResult?.ok) {
    return {
      ok: false,
      error:
        releaseResult?.message ||
        releaseResult?.error ||
        "Expired claim could not be released.",
    };
  }

  if (!releaseResult.released || !releaseResult.advanceBookingId) {
    return { ok: true };
  }

  const { data: booking, error: bookingError } = await supabase
    .from("advance_bookings")
    .select(
      "id, pickup_lat, pickup_lng, vehicle_type, scheduled_pickup_at, status"
    )
    .eq("id", releaseResult.advanceBookingId)
    .eq("status", "open")
    .maybeSingle();

  if (bookingError) {
    return { ok: false, error: bookingError.message };
  }

  const bookingRow = booking as any;
  if (!bookingRow) {
    return { ok: true };
  }

  const pickupLat = Number(bookingRow.pickup_lat);
  const pickupLng = Number(bookingRow.pickup_lng);
  const scheduledPickupAt = new Date(bookingRow.scheduled_pickup_at);
  const vehicleType = String(bookingRow.vehicle_type || "") as VehicleType;

  if (
    !Number.isFinite(pickupLat) ||
    !Number.isFinite(pickupLng) ||
    Number.isNaN(scheduledPickupAt.getTime()) ||
    !["tricycle", "motorcycle"].includes(vehicleType)
  ) {
    return {
      ok: false,
      error: "Expired booking has invalid reoffer data.",
    };
  }

  const reoffer = await offerAdvanceBooking({
    advanceBookingId: String(bookingRow.id),
    pickupLat,
    pickupLng,
    vehicleType,
    scheduledPickupAt,
    excludedDriverIds: [
      String(releaseResult.expiredDriverId || driverId),
    ],
  });

  if (!reoffer.ok) {
    return { ok: false, error: reoffer.error };
  }

  return { ok: true };
}

export async function GET(req: NextRequest) {
  const auth = await resolveAuthenticatedDriver(req);

  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: noStoreHeaders() }
    );
  }

  const expiryResult = await releaseAndReofferExpiredClaim(auth.driverId);

  if (!expiryResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "EXPIRED_CLAIM_PROCESSING_FAILED",
        message: expiryResult.error,
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }

  const supabase = supabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data: activeQueueRows, error: activeQueueError } = await supabase
    .from("advance_booking_queue")
    .select(
      [
        "id",
        "advance_booking_id",
        "status",
        "fare_preparation_expires_at",
        "departure_option",
        "departure_lat",
        "departure_lng",
        "departure_set_at",
      ].join(", ")
    )
    .eq("driver_id", auth.driverId)
    .eq("status", "tentative_committed")
    .gt("fare_preparation_expires_at", nowIso)
    .order("fare_preparation_expires_at", { ascending: true })
    .limit(1);

  if (activeQueueError) {
    return NextResponse.json(
      { ok: false, error: activeQueueError.message },
      { status: 500, headers: noStoreHeaders() }
    );
  }

  let activeClaim: Record<string, unknown> | null = null;
  const activeQueue = (activeQueueRows?.[0] as any) ?? null;

  if (activeQueue?.advance_booking_id) {
    const { data: activeBooking, error: activeBookingError } = await supabase
      .from("advance_bookings")
      .select(
        [
          "id",
          "pickup_address",
          "pickup_lat",
          "pickup_lng",
          "destination_address",
          "destination_lat",
          "destination_lng",
          "scheduled_pickup_at",
          "booking_mode",
          "fare_bracket",
          "distance_km",
          "vehicle_type",
          "status",
          "proposed_ride_fare",
          "proposed_platform_fee",
          "pickup_fee",
          "total_fare",
          "passenger_response_expires_at",
        ].join(", ")
      )
      .eq("id", activeQueue.advance_booking_id)
      .in("status", ["open", "fare_proposed"])
      .gt("scheduled_pickup_at", nowIso)
      .maybeSingle();

    const activeBookingRow = activeBooking as any;

    if (activeBookingError) {
      return NextResponse.json(
        { ok: false, error: activeBookingError.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    if (activeBooking) {
      const remaining = secondsRemaining(
        activeQueue.fare_preparation_expires_at
      );

      activeClaim = {
        queue_entry_id: activeQueue.id,
        queueEntryId: activeQueue.id,
        advance_booking_id: activeBookingRow.id,
        advanceBookingId: activeBookingRow.id,
        queue_status: activeQueue.status,
        queueStatus: activeQueue.status,

        pickup_label: activeBookingRow.pickup_address,
        pickup: activeBookingRow.pickup_address,
        pickup_lat: activeBookingRow.pickup_lat,
        pickupLat: activeBookingRow.pickup_lat,
        pickup_lng: activeBookingRow.pickup_lng,
        pickupLng: activeBookingRow.pickup_lng,

        dropoff_label: activeBookingRow.destination_address,
        destination: activeBookingRow.destination_address,
        destination_lat: activeBookingRow.destination_lat,
        destinationLat: activeBookingRow.destination_lat,
        destination_lng: activeBookingRow.destination_lng,
        destinationLng: activeBookingRow.destination_lng,

        scheduled_pickup_at: activeBookingRow.scheduled_pickup_at,
        scheduledPickupAt: activeBookingRow.scheduled_pickup_at,
        booking_mode: activeBookingRow.booking_mode,
        bookingMode: activeBookingRow.booking_mode,
        fare_bracket: activeBookingRow.fare_bracket,
        fareBracket: activeBookingRow.fare_bracket,
        trip_distance_km: activeBookingRow.distance_km,
        tripDistanceKm: activeBookingRow.distance_km,
        vehicle_type: activeBookingRow.vehicle_type,
        vehicleType: activeBookingRow.vehicle_type,
        booking_status: activeBookingRow.status,
        bookingStatus: activeBookingRow.status,
        proposed_ride_fare: activeBookingRow.proposed_ride_fare,
        proposedRideFare: activeBookingRow.proposed_ride_fare,
        proposed_platform_fee: activeBookingRow.proposed_platform_fee,
        proposedPlatformFee: activeBookingRow.proposed_platform_fee,
        pickup_fee: activeBookingRow.pickup_fee,
        pickupFee: activeBookingRow.pickup_fee,
        total_fare: activeBookingRow.total_fare,
        totalFare: activeBookingRow.total_fare,
        passenger_response_expires_at:
          activeBookingRow.passenger_response_expires_at,
        passengerResponseExpiresAt:
          activeBookingRow.passenger_response_expires_at,

        fare_preparation_expires_at:
          activeQueue.fare_preparation_expires_at,
        farePreparationExpiresAt:
          activeQueue.fare_preparation_expires_at,
        seconds_remaining: remaining,
        secondsRemaining: remaining,

        departure_option: activeQueue.departure_option,
        departureOption: activeQueue.departure_option,
        departure_lat: activeQueue.departure_lat,
        departureLat: activeQueue.departure_lat,
        departure_lng: activeQueue.departure_lng,
        departureLng: activeQueue.departure_lng,
        departure_set_at: activeQueue.departure_set_at,
        departureSetAt: activeQueue.departure_set_at,
      };
    }
  }

  const { data: queueRows, error: queueError } = await supabase
    .from("advance_booking_queue")
    .select("id, advance_booking_id, offer_sent_at, offer_expires_at")
    .eq("driver_id", auth.driverId)
    .eq("status", "offered")
    .lte("offer_sent_at", nowIso)
    .gt("offer_expires_at", nowIso)
    .order("offer_sent_at", { ascending: true });

  if (queueError) {
    return NextResponse.json(
      { ok: false, error: queueError.message },
      { status: 500, headers: noStoreHeaders() }
    );
  }

  const bookingIds = Array.from(
    new Set(
      (queueRows ?? []).map((r: any) => r.advance_booking_id).filter(Boolean)
    )
  );

  if (bookingIds.length === 0) {
    return NextResponse.json(
      { ok: true, activeClaim, offers: [] },
      { headers: noStoreHeaders() }
    );
  }

  const { data: bookingRows, error: bookingError } = await supabase
    .from("advance_bookings")
    .select(
      [
        "id",
        "pickup_address",
        "destination_address",
        "scheduled_pickup_at",
        "booking_mode",
        "fare_bracket",
        "distance_km",
        "vehicle_type",
      ].join(", ")
    )
    .in("id", bookingIds)
    .eq("status", "open")
    .gt("scheduled_pickup_at", nowIso);

  if (bookingError) {
    return NextResponse.json(
      { ok: false, error: bookingError.message },
      { status: 500, headers: noStoreHeaders() }
    );
  }

  const bookingById = new Map<string, any>();
  for (const booking of bookingRows ?? []) {
    bookingById.set(String((booking as any).id), booking);
  }

  const offers =
    queueRows
      ?.map((row: any) => {
        const booking =
          bookingById.get(String(row.advance_booking_id)) ?? null;

        if (!booking) return null;

        const remaining = secondsRemaining(row.offer_expires_at);

        return {
          offer_id: row.id,
          offerId: row.id,
          advance_booking_id: row.advance_booking_id,
          advanceBookingId: row.advance_booking_id,

          pickup_label: booking.pickup_address,
          pickup: booking.pickup_address,
          dropoff_label: booking.destination_address,
          destination: booking.destination_address,

          scheduled_pickup_at: booking.scheduled_pickup_at,
          scheduledPickupAt: booking.scheduled_pickup_at,

          booking_mode: booking.booking_mode,
          bookingMode: booking.booking_mode,
          fare_bracket: booking.fare_bracket,
          fareBracket: booking.fare_bracket,
          trip_distance_km: booking.distance_km,
          tripDistanceKm: booking.distance_km,
          vehicle_type: booking.vehicle_type,
          vehicleType: booking.vehicle_type,
          offer_expires_at: row.offer_expires_at,
          offerExpiresAt: row.offer_expires_at,
          seconds_remaining: remaining,
          secondsRemaining: remaining,
        };
      })
      .filter(Boolean) ?? [];

  return NextResponse.json(
    { ok: true, activeClaim, offers },
    { headers: noStoreHeaders() }
  );
}
