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

    // 1) Canonical booking read
    const { data: booking, error } = await supabase
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
      .maybeSingle();

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

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_NOT_FOUND" },
        { status: 404 }
      );
    }

    // 2) Driver display hydration from factual read model
    let driver_name: string | null = null;

    if (booking.id) {
      const { data: rideRow, error: rideErr } = await supabase
        .from("dispatch_rides_view")
        .select("driver_name")
        .eq("booking_id", booking.id)
        .maybeSingle();

      if (!rideErr && rideRow) {
        driver_name = (rideRow as any).driver_name ?? null;
      }
    }

    // 3) Return enriched payload without changing existing shape
    const enriched = {
      ...booking,
      driver_name,
    };

    return NextResponse.json({
      ok: true,
      booking: enriched,
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