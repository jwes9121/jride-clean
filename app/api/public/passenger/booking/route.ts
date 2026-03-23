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
        passenger_fare_response
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

    const { data: rideRow, error: rideErr } = await supabase
      .from("dispatch_rides_v1")
      .select("driver_name, driver_to_pickup_km, pickup_distance_fee")
      .eq("booking_code", booking.booking_code)
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

