import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

type VendorStatus = "preparing" | "driver_arrived" | "picked_up" | "completed";

function calcTotalBill(row: any): number {
  const base = Number(row.base_fee ?? 0);
  const dist = Number(row.distance_fare ?? 0);
  const wait = Number(row.waiting_fee ?? 0);
  const extra = Number(row.extra_stop_fee ?? 0);
  return base + dist + wait + extra;
}

export async function GET() {
  try {
    if (!supabase) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("bookings")
      .select(
        [
          "id",
          "booking_code",
          "passenger_name",
          "service_type",
          "vendor_status",
          "created_at",
          "base_fee",
          "distance_fare",
          "waiting_fee",
          "extra_stop_fee"
        ].join(", ")
      )
      .eq("service_type", "takeout")
      .gte("created_at", today.toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const orders = (data ?? []).map((row: any) => ({
      id: row.id,
      booking_code: row.booking_code,
      customer_name: row.passenger_name,
      vendor_status: row.vendor_status,
      created_at: row.created_at,
      service_type: row.service_type,
      total_bill: calcTotalBill(row),
    }));

    return NextResponse.json({ orders });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!supabase) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const body = await req.json();
    const { bookingCode, action } = body as {
      bookingCode?: string;
      action?: string;
    };

    if (!bookingCode) {
      return NextResponse.json({ error: "bookingCode is required" }, { status: 400 });
    }

    let nextStatus: VendorStatus;

    switch (action) {
      case "driver_arrived":
        nextStatus = "driver_arrived";
        break;
      case "picked_up":
        nextStatus = "picked_up";
        break;
      case "completed":
        nextStatus = "completed";
        break;
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const updates: any = {
      vendor_status: nextStatus,
    };

    const now = new Date().toISOString();

    // 🔁 KEEP VENDOR + CUSTOMER IN SYNC
    if (nextStatus === "driver_arrived") {
      updates.vendor_driver_arrived_at = now;
      // customer sees: "Driver arrived at vendor"
      updates.customer_status = "driver_at_vendor";
    }

    if (nextStatus === "picked_up") {
      updates.vendor_order_picked_at = now;
      // customer sees: "On the way"
      updates.customer_status = "on_the_way";
    }

    if (nextStatus === "completed") {
      // final state for customer
      updates.customer_status = "completed";
    }

    const { data, error } = await supabase
      .from("bookings")
      .update(updates)
      .eq("booking_code", bookingCode)
      .select(
        [
          "id",
          "booking_code",
          "passenger_name",
          "service_type",
          "vendor_status",
          "created_at",
          "base_fee",
          "distance_fare",
          "waiting_fee",
          "extra_stop_fee"
        ].join(", ")
      )
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const order = {
      id: data.id,
      booking_code: data.booking_code,
      customer_name: data.passenger_name,
      vendor_status: data.vendor_status,
      created_at: data.created_at,
      service_type: data.service_type,
      total_bill: calcTotalBill(data),
    };

    return NextResponse.json({ order });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
