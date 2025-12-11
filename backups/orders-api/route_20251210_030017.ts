import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

function calcTotalBill(row: any): number {
  const base = Number(row.base_fee ?? 0);
  const dist = Number(row.distance_fare ?? 0);
  const wait = Number(row.waiting_fee ?? 0);
  const extra = Number(row.extra_stop_fee ?? 0);
  return base + dist + wait + extra;
}

export async function GET(
  _request: Request,
  context: { params: { bookingCode: string } }
) {
  try {
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    const bookingCode = context.params.bookingCode;

    const { data, error } = await supabase
      .from("bookings")
      .select(
        [
          "id",
          "booking_code",
          "passenger_name",
          "service_type",
          "customer_status",
          "vendor_status",
          "base_fee",
          "distance_fare",
          "waiting_fee",
          "extra_stop_fee",
          "company_cut",
          "driver_payout",
          "created_at",
          "vendor_driver_arrived_at",
          "vendor_order_picked_at"
        ].join(", ")
      )
      .eq("booking_code", bookingCode)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!data) {
      return NextResponse.json(
        { error: "Booking not found" },
        { status: 404 }
      );
    }

    const total_bill = calcTotalBill(data);

    const booking = {
      id: data.id,
      booking_code: data.booking_code,
      passenger_name: data.passenger_name,
      service_type: data.service_type,
      customer_status: data.customer_status,
      vendor_status: data.vendor_status,
      base_fee: Number(data.base_fee ?? 0),
      distance_fare: Number(data.distance_fare ?? 0),
      waiting_fee: Number(data.waiting_fee ?? 0),
      extra_stop_fee: Number(data.extra_stop_fee ?? 0),
      company_cut: Number(data.company_cut ?? 0),
      driver_payout: Number(data.driver_payout ?? 0),
      total_bill,
      created_at: data.created_at,
      vendor_driver_arrived_at: data.vendor_driver_arrived_at,
      vendor_order_picked_at: data.vendor_order_picked_at
    };

    return NextResponse.json({ booking });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
