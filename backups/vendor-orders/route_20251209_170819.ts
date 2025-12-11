import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    "[vendor-orders API] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars."
  );
}

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

type VendorStatus = "preparing" | "driver_arrived" | "picked_up" | "completed";

export async function GET() {
  try {
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase is not configured on the server." },
        { status: 500 }
      );
    }

    // Today only, takeout service type
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isoStart = today.toISOString();

    const { data, error } = await supabase
      .from("bookings")
      .select(
        "id, booking_code, customer_name, total_bill, vendor_status, created_at, service_type"
      )
      .eq("service_type", "takeout")
      .gte("created_at", isoStart)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[vendor-orders GET] Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ orders: data ?? [] });
  } catch (err: any) {
    console.error("[vendor-orders GET] Unexpected error:", err);
    return NextResponse.json(
      { error: err.message || "Unexpected server error." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase is not configured on the server." },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => null);
    const bookingCode: string | undefined = body?.bookingCode;
    const action: string | undefined = body?.action;

    if (!bookingCode || !action) {
      return NextResponse.json(
        { error: "Missing bookingCode or action." },
        { status: 400 }
      );
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
        return NextResponse.json(
          { error: `Unsupported action: ${action}` },
          { status: 400 }
        );
    }

    const updates: Record<string, any> = {
      vendor_status: nextStatus,
    };

    // Optional: timestamps for audit
    const now = new Date().toISOString();
    if (nextStatus === "driver_arrived") {
      updates["vendor_driver_arrived_at"] = now;
    } else if (nextStatus === "picked_up") {
      updates["vendor_order_picked_at"] = now;
      // When order is picked up, customer sees "on the way"
      updates["customer_status"] = "on_the_way";
    } else if (nextStatus === "completed") {
      updates["customer_status"] = "completed";
    }

    const { data, error } = await supabase
      .from("bookings")
      .update(updates)
      .eq("booking_code", bookingCode)
      .select(
        "id, booking_code, customer_name, total_bill, vendor_status, created_at, service_type"
      )
      .maybeSingle();

    if (error) {
      console.error("[vendor-orders POST] Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!data) {
      return NextResponse.json(
        { error: "Booking not found for given code." },
        { status: 404 }
      );
    }

    return NextResponse.json({ order: data });
  } catch (err: any) {
    console.error("[vendor-orders POST] Unexpected error:", err);
    return NextResponse.json(
      { error: err.message || "Unexpected server error." },
      { status: 500 }
    );
  }
}
