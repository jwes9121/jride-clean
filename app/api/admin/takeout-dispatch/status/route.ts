import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED = new Set([
  "requested",
  "preparing",
  "pickup_ready",
  "driver_assigned",
  "rider_arrived_vendor",
  "picked_up",
  "delivering",
  "completed",
  "cancelled",
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
  if (s === "pickedup") return "picked_up";
  return s;
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
    .select("id,booking_code,service_type,vendor_status,customer_status,assigned_driver_id")
    .eq("id", orderId)
    .eq("service_type", "takeout")
    .single();

  if (existing.error || !existing.data) {
    return json(404, { ok: false, error: "TAKEOUT_ORDER_NOT_FOUND", message: existing.error?.message || "Takeout order not found" });
  }

  const current = normStatus((existing.data as any).vendor_status || (existing.data as any).customer_status || "requested");
  if ((current === "completed" || current === "cancelled") && nextStatus !== "preparing") {
    return json(409, { ok: false, error: "TAKEOUT_ORDER_CLOSED", message: "Closed takeout orders can only be reopened to preparing" });
  }

  if (current === "pickup_ready" && nextStatus === "preparing") {
    return json(409, { ok: false, error: "INVALID_STATUS_MOVEMENT", message: "pickup_ready cannot move back to preparing" });
  }

  const patch: any = {
    vendor_status: nextStatus,
    customer_status: nextStatus === "requested" ? "requested" : nextStatus,
  };

  if (nextStatus === "requested" || nextStatus === "cancelled") {
    patch.assigned_driver_id = null;
  }

  const up = await admin
    .from("bookings")
    .update(patch)
    .eq("id", orderId)
    .eq("service_type", "takeout")
    .select("id,booking_code,service_type,vendor_status,customer_status,assigned_driver_id,updated_at")
    .single();

  if (up.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: up.error.message });
  }

  return json(200, { ok: true, order: up.data, guard: "manual_takeout_status_guard_v1" });
}
