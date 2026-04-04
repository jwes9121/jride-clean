import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const bookingId = body.booking_id || body.bookingId || null;
    const bookingCode = body.booking_code || body.bookingCode || null;
    const rawResponse = body.response || body.action;

    if (!bookingId && !bookingCode) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING" },
        { status: 400 }
      );
    }

    const normalized =
      rawResponse === "accept" || rawResponse === "accepted"
        ? "accepted"
        : rawResponse === "reject" || rawResponse === "rejected"
        ? "rejected"
        : null;

    if (!normalized) {
      return NextResponse.json(
        { ok: false, error: "INVALID_RESPONSE" },
        { status: 400 }
      );
    }

    // 🔥 CRITICAL FIX: support BOTH id and booking_code
    let query = supabase.from("bookings").select("*");

    if (bookingId) {
      query = query.eq("id", bookingId);
    } else {
      query = query.eq("booking_code", bookingCode);
    }

    const { data: booking, error } = await query.single();

    if (error || !booking) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING" },
        { status: 400 }
      );
    }

    if (booking.status !== "fare_proposed") {
      return NextResponse.json(
        { ok: false, error: "INVALID_STATUS", current: booking.status },
        { status: 409 }
      );
    }

    const nextStatus = normalized === "accepted" ? "ready" : "searching";

    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        passenger_fare_response: normalized,
        status: nextStatus,
      })
      .eq("id", booking.id);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      booking_id: booking.id,
      status: nextStatus,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}