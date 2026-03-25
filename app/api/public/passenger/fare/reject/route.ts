import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: Request) {
  try {
 const supabase = createClient();
    const body = await req.json();
    const bookingCode = body.booking_code;

    if (!bookingCode) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING_CODE" },
        { status: 400 }
      );
    }

    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("*")
      .eq("booking_code", bookingCode)
      .single();

    if (fetchError || !booking) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_NOT_FOUND" },
        { status: 404 }
      );
    }

    if (booking.status !== "fare_proposed") {
      return NextResponse.json(
        { ok: false, error: "INVALID_STATUS" },
        { status: 409 }
      );
    }

    const updatePayload = {
      passenger_fare_response: "rejected",
      proposed_fare: null,
      verified_fare: null,
      driver_id: null,
      assigned_driver_id: null,
      status: "requested",
    };

    const { error: updateError } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", booking.id);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: "REJECT_UPDATE_FAILED", message: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      booking_code: bookingCode,
      reassigned: true,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: e.message },
      { status: 500 }
    );
  }
}