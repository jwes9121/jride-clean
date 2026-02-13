import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

type VendorStatus = "preparing" | "driver_arrived" | "picked_up" | "completed";

export async function GET() {
  try {
    if (!supabase) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("bookings")
      .select("id, booking_code, passenger_name, total_service, vendor_status, created_at, service_type")
      .eq("service_type", "takeout")
      .gte("created_at", today.toISOString())
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({
      orders: (data ?? []).map((o) => ({
        ...o,
        customer_name: o.passenger_name, // ✅ UI compatibility fix
        total_bill: o.total_service       // ✅ uses your real fare field
      }))
    });

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
    const { bookingCode, action } = body;

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
      vendor_status: nextStatus
    };

    const now = new Date().toISOString();

    if (nextStatus === "driver_arrived") updates.vendor_driver_arrived_at = now;
    if (nextStatus === "picked_up") updates.vendor_order_picked_at = now;
    if (nextStatus === "completed") updates.customer_status = "completed";

    const { data, error } = await supabase
      .from("bookings")
      .update(updates)
      .eq("booking_code", bookingCode)
      .select("id, booking_code, passenger_name, total_service, vendor_status, created_at, service_type")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({
      order: {
        ...data,
        customer_name: data.passenger_name,
        total_bill: data.total_service
      }
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
