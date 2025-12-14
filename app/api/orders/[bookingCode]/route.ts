import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";

export async function GET(
  req: Request,
  { params }: { params: { bookingCode: string } }
) {
  const supabase = createRouteHandlerClient({ cookies });
  const { bookingCode } = params;

  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("booking_code", bookingCode)
    .single();

  if (error || !data || typeof data !== "object") {
    return NextResponse.json(
      { error: error?.message ?? "Booking not found" },
      { status: 404 }
    );
  }

  // ✅ Type narrowing — from here onward TS knows this is a booking row
  const booking = data as any;

  const fare_breakdown = booking.fare_breakdown ?? {};

  return NextResponse.json({
    id: booking.id,
    booking_code: booking.booking_code,
    passenger_name: booking.passenger_name,
    service_type: booking.service_type,
    status: booking.status,
    customer_status: booking.customer_status,
    vendor_status: booking.vendor_status,

    base_fee: fare_breakdown.base_fee,
    extra_stop_fee: fare_breakdown.extra_stop_fee,
    company_cut: fare_breakdown.company_cut,
    driver_payout: Number(booking.driver_payout ?? 0),

    created_at: booking.created_at,
    updated_at: booking.updated_at,
    vendor_driver_arrived_at: booking.vendor_driver_arrived_at,
  });
}
