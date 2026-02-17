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
      
// JRIDE_TRACK_UID_BYPASS_BEGIN
  // TEMP TEST BYPASS (SERVICE ROLE):
  // Allows tracking ONLY when uid matches created_by_user_id, even if user session cookies are missing.
  // Requires SUPABASE_SERVICE_ROLE_KEY (server-only) in env.
  // Usage: /ride/track?booking_code=...&uid=PASSENGER_UUID   (or code=...)
  try {
    const url2 = new URL(req.url);
    const code2 = (url2.searchParams.get("booking_code") || url2.searchParams.get("code") || "").trim();
    const uid = (url2.searchParams.get("uid") || "").trim();
    const uidOk = /^[0-9a-fA-F-]{36}$/.test(uid);

    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      (process.env as any).SUPABASE_SERVICE_KEY ||
      "";

    const sbUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      "";

    if (code2 && uidOk && serviceKey && sbUrl) {
      const { createClient: createAdminClient } = await import("@supabase/supabase-js");
      const admin = createAdminClient(sbUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { "X-Client-Info": "jride-track-bypass" } },
      });

      const { data: row2, error: err2 } = await admin
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
        .eq("booking_code", code2)
        .limit(1)
        .maybeSingle();

      if (!err2 && row2 && String((row2 as any).created_by_user_id || "").toLowerCase() === uid.toLowerCase()) {
        const b: any = row2 as any;
        const driverId = (b.driver_id || b.assigned_driver_id) as string | null;

        let driverProfile: any = null;
        let driverLocation: any = null;

        if (driverId) {
          const { data: dp } = await admin
            .from("driver_profiles")
            .select("driver_id, full_name, callsign, municipality, vehicle_type, plate_number, phone")
            .eq("driver_id", driverId)
            .maybeSingle();
          driverProfile = dp || null;

          const { data: dl } = await admin
            .from("driver_locations_latest")
            .select("driver_id, latitude, longitude, updated_at")
            .eq("driver_id", driverId)
            .maybeSingle();
          driverLocation = dl || null;
        }

        return NextResponse.json({
          ok: true,
          booking: row2,
          driver: driverProfile,
          driver_location: driverLocation,
        });
      }
    }
  } catch (e) {
    // ignore bypass errors
  }
// JRIDE_TRACK_UID_BYPASS_END

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





