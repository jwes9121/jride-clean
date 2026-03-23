import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const { searchParams } = new URL(req.url);

    const bookingCode = String(
      searchParams.get("code") ||
      searchParams.get("booking_code") ||
      ""
    ).trim();

    if (!bookingCode) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING_CODE" },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          },
        }
      );
    }

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
        trip_distance_km
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
          debug: {
            supabase_url: process.env.SUPABASE_URL || null,
            next_public_supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
          },
        },
        {
          status: 500,
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          },
        }
      );
    }

    const booking = bookingRows?.[0] ?? null;

    if (!booking) {
      return NextResponse.json(
        {
          ok: false,
          error: "BOOKING_NOT_FOUND",
          debug: {
            supabase_url: process.env.SUPABASE_URL || null,
            next_public_supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
          },
        },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          },
        }
      );
    }

    let driver_name: string | null = null;
let driver_lat: number | null = null;
let driver_lng: number | null = null;
let pickup_lat: number | null = null;
let pickup_lng: number | null = null;
let dropoff_lat: number | null = null;
let dropoff_lng: number | null = null;

let driver_to_pickup_km: number | null = (booking as any).driver_to_pickup_km ?? null;
let pickup_distance_fee: number | null = (booking as any).pickup_distance_fee ?? null;
let trip_distance_km: number | null = (booking as any).trip_distance_km ?? null;

    const { data: rideRow, error: rideErr } = await supabase
      .from("dispatch_rides_v1")
      .select(`
  driver_name,
  driver_lat,
  driver_lng,
  pickup_lat,
  pickup_lng,
  dropoff_lat,
  dropoff_lng,
  driver_to_pickup_km,
  pickup_distance_fee
`)
      .eq("booking_code", booking.booking_code)
      .maybeSingle();

    if (!rideErr && rideRow) {
  driver_name = (rideRow as any).driver_name ?? null;
  driver_lat = (rideRow as any).driver_lat ?? null;
  driver_lng = (rideRow as any).driver_lng ?? null;

  pickup_lat = (rideRow as any).pickup_lat ?? null;
  pickup_lng = (rideRow as any).pickup_lng ?? null;

  dropoff_lat = (rideRow as any).dropoff_lat ?? null;
  dropoff_lng = (rideRow as any).dropoff_lng ?? null;
}

    return NextResponse.json(
      {
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
        debug: {
          supabase_url: process.env.SUPABASE_URL || null,
          next_public_supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: String(e?.message ?? e),
        debug: {
          supabase_url: process.env.SUPABASE_URL || null,
          next_public_supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
        },
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  }
}




