import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type DispatchActionName =
  | "assign"
  | "reassign"
  | "on_the_way"
  | "start_trip"
  | "drop_off"
  | "cancel";

type RequestBody = {
  action: DispatchActionName;
  bookingId: string;
};

const BOOKING_FIELDS = `
  id,
  booking_code,
  status,
  assigned_driver_id,
  from_label,
  to_label,
  pickup_lat,
  pickup_lng,
  dropoff_lat,
  dropoff_lng,
  created_at
`;

type BookingRowDb = {
  id: string;
  booking_code: string;
  status: string;
  assigned_driver_id: string | null;
  from_label: string | null;
  to_label: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  created_at: string;
};

type DriverLocationRow = {
  driver_id: string;
  lat: number | null;
  lng: number | null;
  status?: string | null;
  town?: string | null;
  updated_at?: string | null;
};

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine distance in km between two lat/lng points.
 */
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371; // km
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

async function fetchBookingById(bookingId: string) {
  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_FIELDS)
    .eq("id", bookingId)
    .maybeSingle();

  if (error) {
    console.error("DISPATCH_FETCH_BOOKING_ERROR", error);
    throw new Error(error.message || "Failed to fetch booking after action.");
  }

  return data as BookingRowDb | null;
}

/**
 * Pick nearest online driver from driver_locations.
 * - If booking has pickup_lat/lng -> use distance
 * - Otherwise -> pick most recently updated online driver
 */
async function pickNearestOnlineDriver(
  booking: BookingRowDb
): Promise<DriverLocationRow | null> {
  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("driver_locations")
    .select("driver_id, lat, lng, status, town, updated_at")
    .eq("status", "online");

  if (error) {
    console.error("DISPATCH_DRIVER_LOCATIONS_ERROR", error);
    throw new Error(error.message || "Failed to load driver locations.");
  }

  const drivers = (data ?? []) as DriverLocationRow[];
  if (!drivers.length) {
    return null;
  }

  const hasPickup =
    typeof booking.pickup_lat === "number" &&
    typeof booking.pickup_lng === "number";

  if (!hasPickup) {
    // No pickup coords, just pick the most recently updated online driver
    const sorted = [...drivers].sort((a, b) => {
      const tA = a.updated_at ? Date.parse(a.updated_at) : 0;
      const tB = b.updated_at ? Date.parse(b.updated_at) : 0;
      return tB - tA; // newest first
    });
    return sorted[0];
  }

  // Use haversine distance from pickup to each driver
  const { pickup_lat, pickup_lng } = booking;
  let best: DriverLocationRow | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const d of drivers) {
    if (typeof d.lat !== "number" || typeof d.lng !== "number") continue;

    const dist = haversineKm(
      pickup_lat as number,
      pickup_lng as number,
      d.lat,
      d.lng
    );

    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }

  // If none had valid coords, fallback to most recent
  if (!best) {
    const sorted = [...drivers].sort((a, b) => {
      const tA = a.updated_at ? Date.parse(a.updated_at) : 0;
      const tB = b.updated_at ? Date.parse(b.updated_at) : 0;
      return tB - tA;
    });
    best = sorted[0];
  }

  return best;
}

async function runAssignOrReassign(bookingId: string, action: DispatchActionName) {
  const supabase = supabaseAdmin();

  const booking = await fetchBookingById(bookingId);
  if (!booking) {
    throw new Error("Booking not found.");
  }

  const driver = await pickNearestOnlineDriver(booking);

  if (!driver) {
    throw new Error("No online drivers available to assign.");
  }

  const { error } = await supabase
    .from("bookings")
    .update({
      assigned_driver_id: driver.driver_id,
      status: "assigned",
    })
    .eq("id", bookingId);

  if (error) {
    console.error("ASSIGN_DRIVER_DB_ERROR", error);
    throw new Error(error.message || "Failed to assign driver.");
  }

  const updated = await fetchBookingById(bookingId);
  return updated;
}

async function runStatusUpdate(bookingId: string, status: string) {
  const supabase = supabaseAdmin();

  const { error } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", bookingId);

  if (error) {
    console.error("BOOKING_STATUS_DB_ERROR", error);
    throw new Error(error.message || "Status update failed.");
  }

  const booking = await fetchBookingById(bookingId);
  return booking;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;

    if (!body?.action || !body?.bookingId) {
      return NextResponse.json(
        {
          error: "INVALID_PAYLOAD",
          message: "Missing action or bookingId.",
        },
        { status: 400 }
      );
    }

    const { action, bookingId } = body;

    let updatedBooking: unknown = null;

    switch (action) {
      case "assign":
      case "reassign": {
        updatedBooking = await runAssignOrReassign(bookingId, action);
        break;
      }

      case "on_the_way": {
        updatedBooking = await runStatusUpdate(bookingId, "on_the_way");
        break;
      }

      case "start_trip": {
        updatedBooking = await runStatusUpdate(bookingId, "in_progress");
        break;
      }

      case "drop_off": {
        updatedBooking = await runStatusUpdate(bookingId, "completed");
        break;
      }

      case "cancel": {
        updatedBooking = await runStatusUpdate(bookingId, "cancelled");
        break;
      }

      default: {
        return NextResponse.json(
          {
            error: "UNKNOWN_ACTION",
            message: `Unsupported action: ${action}`,
          },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      {
        ok: true,
        action,
        bookingId,
        booking: updatedBooking,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("DISPATCH_ACTION_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      {
        error: "DISPATCH_ACTION_UNEXPECTED_ERROR",
        message: err?.message ?? "Unexpected error while performing action.",
      },
      { status: 500 }
    );
  }
}
