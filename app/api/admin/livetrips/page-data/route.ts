import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase();

    // =========================================================
    // 1) DRIVER PRESENCE
    // =========================================================
    const { data: drivers, error: driverErr } = await supabase
      .from("driver_locations")
      .select("*");

    if (driverErr) {
      return NextResponse.json({
        ok: false,
        error: "DRIVER_LOCATIONS_FAILED",
        message: driverErr.message,
      });
    }

    // =========================================================
    // 2) QUEUE + ACTIVE BOOKINGS (SOURCE OF TRUTH)
    // =========================================================
    const { data: bookings, error: bookingErr } = await supabase
      .from("bookings")
      .select("*")
      .in("status", [
        "requested",
        "searching",
        "assigned",
        "accepted",
        "fare_proposed",
        "ready",
        "on_the_way",
        "arrived",
        "on_trip"
      ])
      .order("updated_at", { ascending: false });

    if (bookingErr) {
      return NextResponse.json({
        ok: false,
        error: "BOOKINGS_FAILED",
        message: bookingErr.message,
      });
    }

    // =========================================================
    // 3) MAP DRIVER → ACTIVE TRIP (for map only)
    // =========================================================
    const tripMap: Record<string, any> = {};

    for (const trip of bookings ?? []) {
      const driverId = trip.driver_id || trip.assigned_driver_id;
      if (driverId) {
        tripMap[driverId] = trip;
      }
    }

    // =========================================================
    // 4) DRIVER VIEW (MAP)
    // =========================================================
    const driverResult = (drivers ?? []).map((d: any) => {
      const trip = tripMap[d.driver_id] || null;

      return {
        driver_id: d.driver_id,
        lat: d.lat,
        lng: d.lng,
        status: d.status,
        town: d.town,
        updated_at: d.updated_at,
        vehicle_type: d.vehicle_type,
        capacity: d.capacity,

        current_trip: trip
          ? {
              booking_code: trip.booking_code,
              status: trip.status,
              passenger_name: trip.passenger_name,
              pickup: trip.from_label,
              dropoff: trip.to_label,
              proposed_fare: trip.proposed_fare,
              verified_fare: trip.verified_fare,
            }
          : null,
      };
    });

    // =========================================================
    // 5) RETURN BOTH QUEUE + DRIVERS
    // =========================================================
    return NextResponse.json({
      ok: true,
      drivers: driverResult,
      trips: bookings ?? [], // <-- THIS FIXES YOUR QUEUE
    });

  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: "LIVETRIPS_ROUTE_FAILED",
      message: String(err?.message ?? err),
    });
  }
}