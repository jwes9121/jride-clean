import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

export async function GET(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const { searchParams } = new URL(req.url);

    const bookingCode = String(
      searchParams.get("code") ||
        searchParams.get("booking_code") ||
        ""
    ).trim();

    const userId = String(
      searchParams.get("uid") ||
        searchParams.get("user_id") ||
        ""
    ).trim();

    let booking: any = null;

    if (bookingCode) {
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
          verified_fare,
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
          { status: 500, headers: noStoreHeaders() }
        );
      }

      booking = bookingRows?.[0] ?? null;
    } else if (userId) {
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
          verified_fare,
          driver_to_pickup_km,
          pickup_distance_fee,
          trip_distance_km,
          pickup_lat,
          pickup_lng,
          dropoff_lat,
          dropoff_lng
        `)
        .eq("created_by_user_id", userId)
        .in("status", [
          "requested",
          "pending",
          "searching",
          "assigned",
          "accepted",
          "fare_proposed",
          "ready",
          "on_the_way",
          "arrived",
          "on_trip",
        ])
        .order("updated_at", { ascending: false })
        .limit(1);

      if (error) {
        return NextResponse.json(
          {
            ok: false,
            error: "BOOKING_READ_FAILED",
            message: error.message,
          },
          { status: 500, headers: noStoreHeaders() }
        );
      }

      booking = bookingRows?.[0] ?? null;
    } else {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING_CODE" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    if (!booking) {
      return NextResponse.json(
        {
          ok: false,
          error: "BOOKING_NOT_FOUND",
        },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    let driver_name: string | null = null;
    let driver_lat: number | null = null;
    let driver_lng: number | null = null;

    const effectiveDriverId =
      (booking as any).driver_id || (booking as any).assigned_driver_id || null;

    if (effectiveDriverId) {
      const { data: driverLoc } = await supabase
        .from("driver_locations_latest")
        .select("lat, lng")
        .eq("driver_id", effectiveDriverId)
        .maybeSingle();

      if (driverLoc) {
        driver_lat = (driverLoc as any).lat ?? null;
        driver_lng = (driverLoc as any).lng ?? null;
      }
    }

    const { data: rideRow, error: rideErr } = await supabase
      .from("dispatch_rides_v1")
      .select("driver_name")
      .eq("booking_code", (booking as any).booking_code)
      .maybeSingle();

    if (!rideErr && rideRow) {
      driver_name = (rideRow as any).driver_name ?? null;
    }

    return NextResponse.json(
      {
        ok: true,
        booking: {
          ...booking,
          driver_name,
          driver_lat,
          driver_lng,
        },
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: String(e?.message ?? e),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}