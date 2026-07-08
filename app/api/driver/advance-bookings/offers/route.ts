import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  resolveAuthenticatedDriver,
  noStoreHeaders,
} from "@/lib/advance-booking/driverAuth";

function secondsRemaining(expiresAt: string | null): number {
  if (!expiresAt) return 0;
  const diff = Math.floor(
    (new Date(expiresAt).getTime() - Date.now()) / 1000
  );
  return diff > 0 ? diff : 0;
}

export async function GET(req: NextRequest) {
  const auth = await resolveAuthenticatedDriver(req);

  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: auth.error,
        message: auth.message,
      },
      {
        status: auth.status,
        headers: noStoreHeaders(),
      }
    );
  }

  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("advance_booking_queue")
    .select(`
      id,
      advance_booking_id,
      offer_sent_at,
      offer_expires_at,
      fare_locked_total,
      advance_bookings (
        pickup_address,
        destination_address,
        scheduled_pickup_at,
        booking_mode,
        fare_bracket,
        distance_km,
        vehicle_type
      )
    `)
    .eq("driver_id", auth.driverId)
    .eq("status", "offered")
    .order("offer_sent_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
      },
      {
        status: 500,
        headers: noStoreHeaders(),
      }
    );
  }

  const offers =
    data?.map((row: any) => ({
      offerId: row.id,
      advanceBookingId: row.advance_booking_id,
      pickup: row.advance_bookings?.pickup_address,
      destination: row.advance_bookings?.destination_address,
      scheduledPickupAt: row.advance_bookings?.scheduled_pickup_at,
      bookingMode: row.advance_bookings?.booking_mode,
      fareBracket: row.advance_bookings?.fare_bracket,
      tripDistanceKm: row.advance_bookings?.distance_km,
      vehicleType: row.advance_bookings?.vehicle_type,
      estimatedFare: row.fare_locked_total,
      offerExpiresAt: row.offer_expires_at,
      secondsRemaining: secondsRemaining(row.offer_expires_at),
    })) ?? [];

  return NextResponse.json(
    {
      ok: true,
      offers,
    },
    {
      headers: noStoreHeaders(),
    }
  );
}