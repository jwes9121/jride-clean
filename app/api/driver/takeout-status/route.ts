import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED = new Set(["requested", "driver_assigned", "rider_arrived_vendor", "picked_up", "delivering", "completed", "cancelled"]);

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function isDriverSecretAuthorized(req: NextRequest): boolean {
  const configured = String(process.env.DRIVER_PING_SECRET || process.env.NEXT_PUBLIC_DRIVER_PING_SECRET || "").trim();
  if (!configured) return true;
  const got = String(req.headers.get("x-jride-driver-secret") || "").trim();
  return got.length > 0 && got === configured;
}

function normStatus(value: any) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "assigned") return "driver_assigned";
  if (s === "arrived_vendor" || s === "rider_at_vendor") return "rider_arrived_vendor";
  if (s === "pickedup") return "picked_up";
  if (s === "canceled") return "cancelled";
  return s;
}

export async function POST(req: NextRequest) {
  if (!isDriverSecretAuthorized(req)) {
    return json(401, { ok: false, error: "UNAUTHORIZED" });
  }

  const admin = getAdmin();
  if (!admin) {
    return json(500, { ok: false, error: "SERVER_MISCONFIG" });
  }

  const body = await req.json().catch(() => ({} as any));
  const driverId = String(body?.driver_id || body?.driverId || "").trim();
  const orderId = String(body?.order_id || body?.orderId || body?.booking_id || body?.bookingId || body?.id || "").trim();
  const bookingCode = String(body?.booking_code || body?.bookingCode || body?.code || "").trim();
  const nextStatus = normStatus(body?.status || body?.vendor_status || body?.vendorStatus);

  if (!driverId) return json(400, { ok: false, error: "driver_id_required" });
  if (!orderId && !bookingCode) return json(400, { ok: false, error: "order_id_or_booking_code_required" });
  if (!ALLOWED.has(nextStatus)) return json(400, { ok: false, error: "bad_status" });

  let q = admin
    .from("bookings")
    .select("id,booking_code,service_type,vendor_status,assigned_driver_id")
    .eq("service_type", "takeout")
    .eq("assigned_driver_id", driverId)
    .limit(1);

  q = orderId ? q.eq("id", orderId) : q.eq("booking_code", bookingCode);
  const existing = await q.maybeSingle();

  if (existing.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: existing.error.message });
  }
  if (!existing.data) {
    return json(404, { ok: false, error: "TAKEOUT_ORDER_NOT_FOUND" });
  }

  const current = normStatus((existing.data as any).vendor_status || "requested");
  if (current === "completed" || current === "cancelled") {
    return json(409, { ok: false, error: "TAKEOUT_ORDER_CLOSED" });
  }

  const patch: any = {
    vendor_status: nextStatus,
    customer_status: nextStatus,
  };

  if (nextStatus === "requested") {
    patch.assigned_driver_id = null;
  }

  const up = await admin
    .from("bookings")
    .update(patch)
    .eq("id", (existing.data as any).id)
    .eq("service_type", "takeout")
    .select("id,booking_code,service_type,vendor_status,customer_status,assigned_driver_id,updated_at")
    .single();

  if (up.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: up.error.message });
  }

  return json(200, { ok: true, order: up.data });
}
