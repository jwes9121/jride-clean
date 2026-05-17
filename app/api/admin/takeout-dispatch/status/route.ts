import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED = new Set([
  "requested",
  "preparing",
  "pickup_ready",
  "driver_assigned",
  "arrived_customer_cash",
  "cash_collected",
  "rider_arrived_vendor",
  "picked_up",
  "delivering",
  "completed",
  "cancelled",
]);

const MOVEMENT_AFTER_CONFIRM = new Set([
  "arrived_customer_cash",
  "cash_collected",
  "rider_arrived_vendor",
  "picked_up",
  "delivering",
  "completed",
]);

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normStatus(value: any) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "ready" || s === "prepared" || s === "ready_for_pickup") return "pickup_ready";
  if (s === "canceled") return "cancelled";
  if (s === "arrived_vendor" || s === "rider_at_vendor") return "rider_arrived_vendor";
  if (s === "arrived_customer" || s === "rider_arrived_customer") return "arrived_customer_cash";
  if (s === "cash_received" || s === "customer_cash_collected") return "cash_collected";
  if (s === "pickedup") return "picked_up";
  return s;
}

function normText(value: any) {
  return String(value || "").trim().toLowerCase();
}

export async function POST(req: NextRequest) {
  const admin = getAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const body = await req.json().catch(() => ({} as any));
  const orderId = String(body?.order_id || body?.orderId || body?.booking_id || body?.bookingId || body?.id || "").trim();
  const nextStatus = normStatus(body?.status || body?.vendor_status || body?.vendorStatus);

  if (!orderId) return json(400, { ok: false, error: "order_id_required", message: "order_id required" });
  if (!ALLOWED.has(nextStatus)) return json(400, { ok: false, error: "bad_status", message: "Unsupported takeout dispatch status" });

  const existing = await admin
    .from("bookings")
    .select("id,booking_code,service_type,vendor_status,customer_status,assigned_driver_id,driver_id,takeout_pricing_status,takeout_customer_confirmed_at,takeout_route_plan")
    .eq("id", orderId)
    .eq("service_type", "takeout")
    .single();

  if (existing.error || !existing.data) {
    return json(404, { ok: false, error: "TAKEOUT_ORDER_NOT_FOUND", message: existing.error?.message || "Takeout order not found" });
  }

  const row: any = existing.data;
  const current = normStatus(row.vendor_status || row.customer_status || "requested");
  const pricingStatus = normText(row.takeout_pricing_status);
  const routePlan = normText(row.takeout_route_plan) || "vendor_first";
  const customerConfirmed = !!row.takeout_customer_confirmed_at || pricingStatus === "customer_confirmed";

  if ((current === "completed" || current === "cancelled") && nextStatus !== "preparing") {
    return json(409, { ok: false, error: "TAKEOUT_ORDER_CLOSED", message: "Closed takeout orders can only be reopened to preparing" });
  }

  if (current === "pickup_ready" && nextStatus === "preparing") {
    return json(409, { ok: false, error: "INVALID_STATUS_MOVEMENT", message: "pickup_ready cannot move back to preparing" });
  }

  if (MOVEMENT_AFTER_CONFIRM.has(nextStatus) && !customerConfirmed) {
    return json(409, {
      ok: false,
      error: "CUSTOMER_CONFIRMATION_REQUIRED",
      message: "Passenger must confirm the takeout total before driver movement statuses.",
    });
  }

  if (routePlan === "customer_cash_first") {
    if (nextStatus === "rider_arrived_vendor" && current !== "cash_collected") {
      return json(409, {
        ok: false,
        error: "CASH_COLLECTION_REQUIRED",
        message: "Driver must collect customer cash before arriving at vendor.",
      });
    }

    if ((nextStatus === "picked_up" || nextStatus === "delivering" || nextStatus === "completed") && current !== "rider_arrived_vendor" && current !== "picked_up" && current !== "delivering") {
      return json(409, {
        ok: false,
        error: "INVALID_CASH_FIRST_SEQUENCE",
        message: "Customer-cash-first orders must pass through cash collection and vendor arrival before pickup, delivery, or completion.",
      });
    }
  } else if (nextStatus === "arrived_customer_cash" || nextStatus === "cash_collected") {
    return json(409, {
      ok: false,
      error: "INVALID_ROUTE_PLAN_STATUS",
      message: "Customer cash collection statuses are only allowed for customer_cash_first route plan.",
    });
  }

  const patch: any = {
    vendor_status: nextStatus,
    customer_status: nextStatus === "requested" ? "requested" : nextStatus,
  };

  if (nextStatus === "arrived_customer_cash") {
    patch.customer_status = "driver_arrived_for_cash";
  }

  if (nextStatus === "cash_collected") {
    patch.customer_status = "cash_collected";
  }

  if (nextStatus === "requested" || nextStatus === "cancelled") {
    patch.assigned_driver_id = null;
    patch.driver_id = null;
    patch.assigned_at = null;
  }

  const up = await admin
    .from("bookings")
    .update(patch)
    .eq("id", orderId)
    .eq("service_type", "takeout")
    .select("id,booking_code,service_type,vendor_status,customer_status,assigned_driver_id,driver_id,takeout_pricing_status,takeout_customer_confirmed_at,takeout_route_plan,updated_at")
    .single();

  if (up.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: up.error.message });
  }

  return json(200, { ok: true, order: up.data, guard: "takeout_status_route_plan_guard_v1" });
}
