import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function text(v: any): string {
  return String(v ?? "").trim();
}

function json(status: number, payload: any) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
    },
  });
}

function createServiceSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase service configuration.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const TAKEOUT_ORDER_SELECT = [
  "id",
  "booking_code",
  "service_type",
  "vendor_id",
  "vendor_status",
  "customer_status",
  "assigned_driver_id",
  "takeout_pricing_status",
  "takeout_delivery_fee",
  "takeout_service_fee",
  "takeout_total_payable",
  "takeout_cash_collection_required",
  "takeout_fee_proposed_by_driver_id",
  "takeout_fee_proposed_at",
  "takeout_fee_expires_at",
  "takeout_customer_confirmed_at",
  "total_bill",
  "takeout_items_subtotal",
  "takeout_route_plan",
  "created_at",
  "updated_at",
].join(",");

export async function GET(req: NextRequest) {
  try {
    const serviceSupabase = createServiceSupabase();
    const url = new URL(req.url);
    const orderId = text(url.searchParams.get("order_id") || url.searchParams.get("orderId") || url.searchParams.get("booking_id") || url.searchParams.get("bookingId") || url.searchParams.get("id"));
    const bookingCode = text(url.searchParams.get("booking_code") || url.searchParams.get("bookingCode") || url.searchParams.get("code"));

    let q = serviceSupabase
      .from("bookings")
      .select(TAKEOUT_ORDER_SELECT)
      .eq("service_type", "takeout")
      .order("created_at", { ascending: false })
      .limit(10);

    if (orderId) {
      q = q.eq("id", orderId).limit(1);
    } else if (bookingCode) {
      q = q.eq("booking_code", bookingCode).limit(1);
    }

    const res = await q;
    if (res.error) {
      return json(500, {
        ok: false,
        error: "TAKEOUT_ORDERS_QUERY_FAILED",
        message: res.error.message,
      });
    }

    const orders = Array.isArray(res.data) ? res.data : [];
    const order = orders[0] || null;

    return json(200, {
      ok: true,
      order,
      orders,
      guard: "takeout_orders_read_v1_no_bookings_device_key_no_ride_fare_no_wallet",
    });
  } catch (err: any) {
    return json(500, {
      ok: false,
      error: "TAKEOUT_ORDERS_READ_FAILED",
      message: err?.message || "Failed to read takeout orders.",
    });
  }
}
