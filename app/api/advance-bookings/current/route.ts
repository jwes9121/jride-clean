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

// Terminal statuses shown in Advance Booking History. cancelled_driver is
// included for forward-compatibility - as of this writing no RPC in the
// codebase actually writes it yet (driver-cancellation-after-lock is a
// separate, not-yet-built "no-show workflow" per earlier design notes),
// so this array element will simply never match any row today.
const HISTORY_STATUSES = [
  "completed",
  "cancelled_no_driver",
  "cancelled_passenger",
  "cancelled_driver",
];

const HISTORY_LIMIT = 50;

// Same extraction pattern already used in app/api/driver/advance-bookings/
// offers/route.ts - passenger_count is not a real column, it's encoded as
// a "[Passenger count] N" prefix line in notes by the Android client.
function passengerCountFromNotes(notes: unknown): number | null {
  const match = String(notes ?? "").match(/\[Passenger count\]\s*(\d+)/i);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : null;
}

function computeDisplayStatus(
  status: string,
  cancellationReason: string | null
): string {
  switch (status) {
    case "completed":
      return "COMPLETED";
    case "cancelled_passenger":
      return "CANCELLED_BY_PASSENGER";
    case "cancelled_driver":
      return "CANCELLED_BY_DRIVER";
    case "cancelled_no_driver":
      return cancellationReason === "passenger_response_expired"
        ? "AUTO_CANCELLED_NO_RESPONSE"
        : "NO_DRIVER_AVAILABLE";
    default:
      return String(status || "").toUpperCase() || "UNKNOWN";
  }
}

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

  // ---------------------------------------------------------------
  // Current booking - query and response shape UNCHANGED from before.
  // ---------------------------------------------------------------
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
  let queue: Record<string, unknown> | null = null;

  if (bookingRow?.current_offer_queue_id) {
    const { data: queueRow, error: queueError } = await supabase
      .from("advance_booking_queue")
      .select(
        [
          "id",
          "driver_id",
          "status",
          "fare_preparation_expires_at",
          "offer_expires_at",
          "departure_distance_km",
        ].join(", ")
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

  const currentBooking = bookingRow
    ? {
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
        departureDistanceKm:
          (queue as any)?.departure_distance_km ?? null,
        queue,
      }
    : null;

  // ---------------------------------------------------------------
  // History - new. Terminal bookings only, most recently updated first.
  // ---------------------------------------------------------------
  const { data: historyRows, error: historyError } = await supabase
    .from("advance_bookings")
    .select(
      [
        "id",
        "pickup_address",
        "destination_address",
        "distance_km",
        "vehicle_type",
        "notes",
        "scheduled_pickup_at",
        "booking_created_at",
        "booking_mode",
        "fare_bracket",
        "status",
        "cancellation_reason",
        "cancelled_at",
        "cancelled_by",
        "committed_driver_id",
        "proposed_ride_fare",
        "proposed_platform_fee",
        "pickup_fee",
        "total_fare",
        "estimated_total",
      ].join(", ")
    )
    .eq("passenger_id", auth.passengerId)
    .in("status", HISTORY_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (historyError) {
    return NextResponse.json(
      {
        ok: false,
        error: historyError.message,
      },
      {
        status: 500,
        headers: noStoreHeaders(),
      }
    );
  }

  const historyList = (historyRows ?? []) as any[];

  // Batched driver-name resolution (one query for every distinct driver
  // across the whole history page, not one query per row).
  const driverIds = Array.from(
    new Set(
      historyList
        .map((row) => row.committed_driver_id)
        .filter((id): id is string => !!id)
    )
  );

  const driverNameById = new Map<string, string>();

  if (driverIds.length > 0) {
    const { data: driverRows } = await supabase
      .from("driver_profiles")
      .select("driver_id, full_name")
      .in("driver_id", driverIds);

    for (const row of (driverRows ?? []) as any[]) {
      const id = String(row?.driver_id || "");
      const name = String(row?.full_name || "").trim();
      if (id && name) driverNameById.set(id, name);
    }
  }

  const history = historyList.map((row) => ({
    id: row.id,
    pickupAddress: row.pickup_address,
    destinationAddress: row.destination_address,
    distanceKm: row.distance_km,
    vehicleType: row.vehicle_type,
    passengerCount: passengerCountFromNotes(row.notes),
    notes: row.notes,
    scheduledPickupAt: row.scheduled_pickup_at,
    bookingCreatedAt: row.booking_created_at,
    bookingMode: row.booking_mode,
    fareBracket: row.fare_bracket,
    status: row.status,
    cancellationReason: row.cancellation_reason,
    displayStatus: computeDisplayStatus(row.status, row.cancellation_reason),
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    committedDriverId: row.committed_driver_id,
    committedDriverName: row.committed_driver_id
      ? driverNameById.get(String(row.committed_driver_id)) ?? null
      : null,
    proposedRideFare: row.proposed_ride_fare,
    proposedPlatformFee: row.proposed_platform_fee,
    pickupFee: row.pickup_fee,
    totalFare: row.total_fare,
    estimatedTotal: row.estimated_total,
  }));

  return NextResponse.json(
    {
      ok: true,
      currentBooking,
      history,
      // Deprecated alias - remove once PassengerAdvanceBookingActivity is
      // confirmed updated and deployed to read currentBooking instead.
      booking: currentBooking,
    },
    {
      headers: noStoreHeaders(),
    }
  );
}
