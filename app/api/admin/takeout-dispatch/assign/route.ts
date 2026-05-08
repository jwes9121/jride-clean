import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  const driverId = String(body?.driver_id || body?.driverId || "").trim();

  if (!orderId) return json(400, { ok: false, error: "order_id_required", message: "order_id required" });
  if (!driverId) return json(400, { ok: false, error: "driver_id_required", message: "driver_id required" });

  const existing = await admin
    .from("bookings")
    .select("id,booking_code,service_type,vendor_status,assigned_driver_id")
    .eq("id", orderId)
    .eq("service_type", "takeout")
    .single();

  if (existing.error || !existing.data) {
    return json(404, { ok: false, error: "TAKEOUT_ORDER_NOT_FOUND", message: existing.error?.message || "Takeout order not found" });
  }

  const currentStatus = String((existing.data as any).vendor_status || "").trim().toLowerCase();
  if (currentStatus === "completed" || currentStatus === "cancelled" || currentStatus === "canceled") {
    return json(409, { ok: false, error: "TAKEOUT_ORDER_CLOSED", message: "Closed takeout orders cannot be assigned" });
  }

  const patch = {
    assigned_driver_id: driverId,
    vendor_status: "driver_assigned",
    customer_status: "driver_assigned",
  };

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

  return json(200, { ok: true, order: up.data });
}
