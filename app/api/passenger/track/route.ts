import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// Passenger tracking endpoint (needed by mobile/web to refresh booking status)
// GET /api/passenger/track?booking_code=JR-UI-...
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const bookingCode = (url.searchParams.get("booking_code") || "").trim();

    if (!bookingCode) {
      return NextResponse.json(
        { ok: false, error: "booking_code is required" },
        { status: 400 }
      );
    }

    const supabase = createClient();
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr) {
      return NextResponse.json(
        { ok: false, error: userErr.message },
        { status: 401 }
      );
    }

    const user = userRes?.user;
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    // IMPORTANT:
    // - bookings has created_by_user_id (confirmed in your schema)
    // - enforce ownership here so passenger only sees their own booking
    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .select(
        [
          "id",
          "booking_code",
          "status",
          "town",
          "from_label",
          "to_label",
          "pickup_lat",
          "pickup_lng",
          "dropoff_lat",
          "dropoff_lng",
          "created_at",
          "updated_at",
          "assigned_driver_id",
          "driver_id",
          "proposed_fare",
          "passenger_fare_response",
          "driver_status",
          "customer_status",
          "created_by_user_id",
        ].join(",")
      )
      .eq("booking_code", bookingCode)
      .eq("created_by_user_id", user.id)
      .maybeSingle();

    if (bErr) {
      return NextResponse.json(
        { ok: false, error: bErr.message },
        { status: 500 }
      );
    }

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "Booking not found" },
        { status: 404 }
      );
    }
  const b: any = booking as any;
  const driverId = (b.driver_id || b.assigned_driver_id) as string | null;
    let driverProfile: any = null;
    let driverLocation: any = null;

    if (driverId) {
      // Driver profile (public table)
      const { data: dp } = await supabase
        .from("driver_profiles")
        .select("driver_id, full_name, callsign, municipality, vehicle_type, plate_number, phone")
        .eq("driver_id", driverId)
        .maybeSingle();

      driverProfile = dp || null;

      // Latest location (your schema shows driver_locations_latest exists)
      const { data: dl } = await supabase
        .from("driver_locations_latest")
        .select("driver_id, latitude, longitude, updated_at")
        .eq("driver_id", driverId)
        .maybeSingle();

      driverLocation = dl || null;
    }

    return NextResponse.json({
      ok: true,
      booking,
      driver: driverProfile,
      driver_location: driverLocation,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}



