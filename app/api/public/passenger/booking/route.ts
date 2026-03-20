import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

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
        { status: 400 }
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

    let driver_name: string | null = null;

    const { data: rideRow, error: rideErr } = await supabase
      .from("dispatch_rides_v1")
      .select("driver_name")
      .eq("booking_code", booking.booking_code)
      .maybeSingle();

    if (!rideErr && rideRow) {
      driver_name = (rideRow as any).driver_name ?? null;
    }

    console.log("PASSENGER_BOOKING_READ", {
      booking_code: booking.booking_code,
      status: booking.status,
      proposed_fare: booking.proposed_fare,
      updated_at: booking.updated_at,
      driver_name,
    });

    return NextResponse.json({
      ok: true,
      booking: {
        ...booking,
        driver_name,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: String(e?.message ?? e),
      },
      { status: 500 }
    );
  }
}