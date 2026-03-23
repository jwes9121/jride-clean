import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const bookingCode = searchParams.get("code");

    if (!bookingCode) {
      return NextResponse.json(
        { ok: false, error: "MISSING_CODE" },
        { status: 400 }
      );
    }

    // ✅ SOURCE OF TRUTH = bookings table
    const { data: bookingRows, error } = await supabase
      .from("bookings")
      .select(`
        id,
        booking_code,
        status,
        driver_id,
        assigned_driver_id,
        created_at,
        updated_at,
        created_by_user_id,
        proposed_fare,
        passenger_fare_response,
        driver_to_pickup_km,
        pickup_distance_fee,
        trip_distance_km,
        pickup_lat,
        pickup_lng,
        dropoff_lat,
        dropoff_lng
      `)
      .eq("booking_code", bookingCode)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "BOOKING_READ_FAILED",
          message: error.message,
        },
        { status: 500 }
      );
    }

    const booking = bookingRows?.[0] ?? null;

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_NOT_FOUND" },
        { status: 404 }
      );
    }

    // ✅ BASE VALUES (from bookings)
    let driver_name: string | null = null;

    const pickup_lat = (booking as any).pickup_lat ?? null;
    const pickup_lng = (booking as any).pickup_lng ?? null;
    const dropoff_lat = (booking as any).dropoff_lat ?? null;
    const dropoff_lng = (booking as any).dropoff_lng ?? null;

    let driver_lat: number | null = null;
    let driver_lng: number | null = null;

    const driver_to_pickup_km =
      (booking as any).driver_to_pickup_km ?? null;

    const pickup_distance_fee =
      (booking as any).pickup_distance_fee ?? null;

    const trip_distance_km =
      (booking as any).trip_distance_km ?? null;

    // ✅ DRIVER LOCATION (REAL SOURCE)
    if (booking.driver_id) {
      const { data: driverLoc } = await supabase
        .from("driver_locations_latest")
        .select("lat, lng")
        .eq("driver_id", booking.driver_id)
        .maybeSingle();

      if (driverLoc) {
        driver_lat = driverLoc.lat ?? null;
        driver_lng = driverLoc.lng ?? null;
      }
    }

    return NextResponse.json({
      ok: true,
      booking: {
        ...booking,
        driver_name,
        driver_lat,
        driver_lng,
        pickup_lat,
        pickup_lng,
        dropoff_lat,
        dropoff_lng,
        driver_to_pickup_km,
        pickup_distance_fee,
        trip_distance_km,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "UNEXPECTED_ERROR",
        message: err?.message ?? "unknown",
      },
      { status: 500 }
    );
  }
}