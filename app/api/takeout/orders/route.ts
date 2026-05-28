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
  "takeout_items_subtotal",
  "takeout_route_plan",
  "takeout_pricing_snapshot",
  "created_at",
  "updated_at",
].join(",");


function obj(v: any): Record<string, any> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as Record<string, any>;
}

function firstValue(...values: any[]): any {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function exposePickupBreakdown(row: any): any {
  const snap = obj(row?.takeout_pricing_snapshot);
  const pickupDistanceKm = firstValue(
    row?.takeout_pickup_distance_km,
    row?.pickup_distance_km,
    snap.takeout_pickup_distance_km,
    snap.takeout_pickup_distance_km_road,
    snap.pickup_distance_km,
    snap.pickup_distance_km_road
  );
  const pickupFreeKm = firstValue(
    row?.takeout_pickup_free_km,
    row?.pickup_free_km,
    snap.takeout_pickup_free_km,
    snap.pickup_free_km
  );
  const pickupBillableKm = firstValue(
    row?.takeout_pickup_billable_excess_km,
    row?.pickup_billable_excess_km,
    snap.takeout_pickup_billable_excess_km,
    snap.pickup_billable_excess_km,
    snap.pickup_billable_km
  );
  const pickupFirstTierKm = firstValue(
    row?.takeout_pickup_first_tier_km,
    row?.pickup_first_tier_km,
    snap.takeout_pickup_first_tier_km,
    snap.pickup_first_tier_km
  );
  const pickupSecondTierKm = firstValue(
    row?.takeout_pickup_second_tier_km,
    row?.pickup_second_tier_km,
    snap.takeout_pickup_second_tier_km,
    snap.pickup_second_tier_km,
    snap.takeout_pickup_beyond_first_tier_km,
    snap.pickup_beyond_first_tier_km
  );
  const pickupFee = firstValue(
    row?.takeout_pickup_distance_fee,
    row?.pickup_distance_fee,
    row?.takeout_pickup_excess_fee,
    row?.pickup_excess_fee,
    snap.takeout_pickup_distance_fee,
    snap.pickup_distance_fee,
    snap.takeout_pickup_excess_fee,
    snap.pickup_excess_fee
  );
  const pickupSource = firstValue(
    row?.takeout_pickup_distance_source,
    row?.pickup_distance_source,
    snap.takeout_pickup_distance_source,
    snap.pickup_distance_source
  );

  return {
    ...row,
    takeout_pickup_distance_km: pickupDistanceKm,
    takeout_pickup_distance_km_road: firstValue(row?.takeout_pickup_distance_km_road, snap.takeout_pickup_distance_km_road, pickupDistanceKm),
    takeout_pickup_free_km: pickupFreeKm,
    takeout_pickup_billable_excess_km: pickupBillableKm,
    takeout_pickup_first_tier_km: pickupFirstTierKm,
    takeout_pickup_second_tier_km: pickupSecondTierKm,
    takeout_pickup_distance_fee: pickupFee,
    takeout_pickup_excess_fee: pickupFee,
    takeout_pickup_distance_source: pickupSource,
    pickup_distance_source: pickupSource,
    pickup_first_tier_km: pickupFirstTierKm,
    pickup_second_tier_km: pickupSecondTierKm,
  };
}

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

    const orders = (Array.isArray(res.data) ? res.data : []).map(exposePickupBreakdown);
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
