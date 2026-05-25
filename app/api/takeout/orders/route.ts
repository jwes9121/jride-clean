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


function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickupExcessFee(km: any): number {
  const distance = Number(km);
  if (!Number.isFinite(distance) || distance <= 1.5) return 0;
  return Math.ceil((distance - 1.5) / 0.5) * 20;
}

function shapeOrder(row: any) {
  if (!row) return row;
  const km = num(row.driver_to_pickup_km ?? row.distance_to_pickup_km);
  const excessKm = km != null && km > 1.5 ? Number((km - 1.5).toFixed(2)) : 0;
  const excessFee = pickupExcessFee(km);
  const baseDelivery = num(row.takeout_delivery_fee);
  const baseTotal = num(row.takeout_total_payable);
  return {
    ...row,
    takeout_pickup_distance_basis: row.takeout_route_plan === "customer_cash_first" ? "driver_to_customer" : "driver_to_vendor",
    takeout_pickup_free_km: 1.5,
    takeout_pickup_excess_km: excessKm,
    takeout_pickup_excess_fee: excessFee,
    takeout_base_delivery_fee: baseDelivery,
    takeout_delivery_fee: baseDelivery != null ? Number((baseDelivery + excessFee).toFixed(2)) : row.takeout_delivery_fee,
    takeout_total_payable: baseTotal != null ? Number((baseTotal + excessFee).toFixed(2)) : row.takeout_total_payable,
  };
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
  "driver_to_pickup_km",
  "distance_to_pickup_km",
  "takeout_cash_collection_required",
  "takeout_fee_proposed_by_driver_id",
  "takeout_fee_proposed_at",
  "takeout_fee_expires_at",
  "takeout_customer_confirmed_at",
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

    const orders = (Array.isArray(res.data) ? res.data : []).map(shapeOrder);
    const order = orders[0] || null;

    return json(200, {
      ok: true,
      order,
      orders,
      guard: "takeout_orders_read_v2_no_bookings_device_key_no_total_bill_no_ride_fare_no_wallet",
    });
  } catch (err: any) {
    return json(500, {
      ok: false,
      error: "TAKEOUT_ORDERS_READ_FAILED",
      message: err?.message || "Failed to read takeout orders.",
    });
  }
}

