import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ACTIVE_STATUSES = [
  "open",
  "fare_proposed",
  "fare_accepted",
  "pickup_fee_pending",
  "pickup_fee_proposed",
  "confirmed",
  "converting",
  "live",
  "dispatcher_intervention",
];

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
  };
}

async function resolvePassenger(req: NextRequest) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!token) {
    return {
      ok: false as const,
      status: 401,
      error: "AUTH_REQUIRED",
      message: "Passenger authentication is required.",
    };
  }

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

  if (!url || !anonKey) {
    return {
      ok: false as const,
      status: 500,
      error: "AUTH_CONFIGURATION_ERROR",
      message: "Passenger authentication is not configured.",
    };
  }

  const supabase = createSupabaseClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabase.auth.getUser(token);
  const passengerId = data.user?.id || "";

  if (error || !passengerId) {
    return {
      ok: false as const,
      status: 401,
      error: "INVALID_SESSION",
      message: "Passenger session is invalid or expired.",
    };
  }

  return {
    ok: true as const,
    passengerId,
  };
}

export async function GET(req: NextRequest) {
  const auth = await resolvePassenger(req);

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
  const nowIso = new Date().toISOString();

  const { data: booking, error: bookingError } = await supabase
    .from("advance_bookings")
    .select(
      [
        "id",
        "passenger_id",
        "pickup_address",
        "pickup_lat",
        "pickup_lng",
        "destination_address",
        "destination_lat",
        "destination_lng",
        "distance_km",
        "vehicle_type",
        "notes",
        "scheduled_pickup_at",
        "booking_mode",
        "fare_bracket",
        "status",
        "current_offer_queue_id",
        "committed_driver_id",
        "passenger_response_expires_at",
        "estimated_fare_min",
        "estimated_fare_max",
        "estimated_pickup_fee",
        "estimated_total",
        "proposed_ride_fare",
        "proposed_platform_fee",
        "pickup_fee",
        "total_fare",
        "departure_option_used",
      ].join(", ")
    )
    .eq("passenger_id", auth.passengerId)
    .in("status", ACTIVE_STATUSES)
    .gt("scheduled_pickup_at", nowIso)
    .order("booking_created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (bookingError) {
    return NextResponse.json(
      {
        ok: false,
        error: bookingError.message,
      },
      {
        status: 500,
        headers: noStoreHeaders(),
      }
    );
  }

  const bookingRow = booking as any;

  if (!bookingRow) {
    return NextResponse.json(
      {
        ok: true,
        booking: null,
      },
      {
        headers: noStoreHeaders(),
      }
    );
  }

  let queue: Record<string, unknown> | null = null;

  if (bookingRow.current_offer_queue_id) {
    const { data: queueRow, error: queueError } = await supabase
      .from("advance_booking_queue")
      .select(
        "id, driver_id, status, fare_preparation_expires_at, offer_expires_at"
      )
      .eq("id", bookingRow.current_offer_queue_id)
      .maybeSingle();

    if (queueError) {
      return NextResponse.json(
        {
          ok: false,
          error: queueError.message,
        },
        {
          status: 500,
          headers: noStoreHeaders(),
        }
      );
    }

    queue = (queueRow as any) ?? null;
  }

  return NextResponse.json(
    {
      ok: true,
      booking: {
        id: bookingRow.id,
        passengerId: bookingRow.passenger_id,
        pickupAddress: bookingRow.pickup_address,
        pickupLat: bookingRow.pickup_lat,
        pickupLng: bookingRow.pickup_lng,
        destinationAddress: bookingRow.destination_address,
        destinationLat: bookingRow.destination_lat,
        destinationLng: bookingRow.destination_lng,
        distanceKm: bookingRow.distance_km,
        vehicleType: bookingRow.vehicle_type,
        notes: bookingRow.notes,
        scheduledPickupAt: bookingRow.scheduled_pickup_at,
        bookingMode: bookingRow.booking_mode,
        fareBracket: bookingRow.fare_bracket,
        status: bookingRow.status,
        currentOfferQueueId: bookingRow.current_offer_queue_id,
        committedDriverId: bookingRow.committed_driver_id,
        passengerResponseExpiresAt:
          bookingRow.passenger_response_expires_at,
        estimatedFareMin: bookingRow.estimated_fare_min,
        estimatedFareMax: bookingRow.estimated_fare_max,
        estimatedPickupFee: bookingRow.estimated_pickup_fee,
        estimatedTotal: bookingRow.estimated_total,
        proposedRideFare: bookingRow.proposed_ride_fare,
        proposedPlatformFee: bookingRow.proposed_platform_fee,
        pickupFee: bookingRow.pickup_fee,
        totalFare: bookingRow.total_fare,
        departureOptionUsed: bookingRow.departure_option_used,
        queue,
      },
    },
    {
      headers: noStoreHeaders(),
    }
  );
}
