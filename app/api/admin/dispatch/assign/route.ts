import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";

const ACTIVE_STATUSES = [
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
];

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });

    const body = await req.json();
    const bookingCode = body?.bookingCode;
    const driverId = body?.driverId;

    if (!bookingCode || !driverId) {
      return NextResponse.json({ ok: false, error: "Missing params" }, { status: 400 });
    }

    // 🔒 CHECK: driver already has active booking
    const { data: existing, error: existingError } = await supabase
      .from("bookings")
      .select("id, booking_code, status")
      .eq("driver_id", driverId)
      .in("status", ACTIVE_STATUSES)
      .limit(1);

    if (existingError) {
      return NextResponse.json({ ok: false, error: existingError.message }, { status: 500 });
    }

    if (existing && existing.length > 0) {
      return NextResponse.json({
        ok: false,
        error: "driver_busy",
        active_booking: existing[0],
      }, { status: 409 });
    }

    // 🔒 VALIDATE booking exists and is assignable
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, status")
      .eq("booking_code", bookingCode)
      .single();

    if (bookingError || !booking) {
      return NextResponse.json({ ok: false, error: "booking_not_found" }, { status: 404 });
    }

    if (booking.status !== "pending") {
      return NextResponse.json({
        ok: false,
        error: "invalid_booking_state",
        current_status: booking.status,
      }, { status: 409 });
    }

    // ✅ ASSIGN
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        driver_id: driverId,
        assigned_driver_id: driverId,
        status: "assigned",
        assigned_at: new Date().toISOString(),
      })
      .eq("booking_code", bookingCode);

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });

  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}