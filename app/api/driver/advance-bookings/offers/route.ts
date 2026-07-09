import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  resolveAuthenticatedDriver,
  noStoreHeaders,
} from "@/lib/advance-booking/driverAuth";

function secondsRemaining(expiresAt: string | null): number {
  if (!expiresAt) return 0;
  const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
  return diff > 0 ? diff : 0;
}

export async function GET(req: NextRequest) {
  const auth = await resolveAuthenticatedDriver(req);

  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: noStoreHeaders() }
    );
  }

  const supabase = supabaseAdmin();

  const { data: queueRows, error: queueError } = await supabase
    .from("advance_booking_queue")
    .select("id, advance_booking_id, offer_sent_at, offer_expires_at")
    .eq("driver_id", auth.driverId)
    .eq("status", "offered")
    .order("offer_sent_at", { ascending: true });

  if (queueError) {
    return NextResponse.json(
      { ok: false, error: queueError.message },
      { status: 500, headers: noStoreHeaders() }
    );
  }

  const bookingIds = Array.from(
    new Set((queueRows ?? []).map((r: any) => r.advance_booking_id).filter(Boolean))
  );

  if (bookingIds.length === 0) {
    return NextResponse.json(
      { ok: true, offers: [] },
      { headers: noStoreHeaders() }
    );
  }

  const { data: bookingRows, error: bookingError } = await supabase
    .from("advance_bookings")
    .select(`
      id,
      pickup_address,
      destination_address,
      scheduled_pickup_at,
      booking_mode,
      fare_bracket,
      distance_km,
      vehicle_type,
      estimated_fare_min,
      estimated_fare_max,
      estimated_pickup_fee,
      estimated_total
    `)
    .in("id", bookingIds);

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
    queueRows?.map((row: any) => {
      const booking = bookingById.get(String(row.advance_booking_id)) ?? null;

      return {
        offer_id: row.id,
        offerId: row.id,
        advance_booking_id: row.advance_booking_id,
        advanceBookingId: row.advance_booking_id,

        pickup_label: booking?.pickup_address ?? null,
        pickup: booking?.pickup_address ?? null,
        dropoff_label: booking?.destination_address ?? null,
        destination: booking?.destination_address ?? null,

        scheduled_pickup_at: booking?.scheduled_pickup_at ?? null,
        scheduledPickupAt: booking?.scheduled_pickup_at ?? null,

        booking_mode: booking?.booking_mode ?? null,
        bookingMode: booking?.booking_mode ?? null,
        fare_bracket: booking?.fare_bracket ?? null,
        fareBracket: booking?.fare_bracket ?? null,
        trip_distance_km: booking?.distance_km ?? null,
        tripDistanceKm: booking?.distance_km ?? null,
        vehicle_type: booking?.vehicle_type ?? null,
        vehicleType: booking?.vehicle_type ?? null,

        estimated_fare: booking?.estimated_total ?? null,
        estimatedFare: booking?.estimated_total ?? null,
        estimated_total: booking?.estimated_total ?? null,
        pickup_fee: booking?.estimated_pickup_fee ?? null,

        offer_expires_at: row.offer_expires_at,
        offerExpiresAt: row.offer_expires_at,
        seconds_remaining: secondsRemaining(row.offer_expires_at),
        secondsRemaining: secondsRemaining(row.offer_expires_at),
      };
    }) ?? [];

  return NextResponse.json(
    { ok: true, offers },
    { headers: noStoreHeaders() }
  );
}