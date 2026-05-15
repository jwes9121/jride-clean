import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function text(v: any): string {
  return String(v ?? "").trim();
}

function lower(v: any): string {
  return text(v).toLowerCase();
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

function isExpired(value: any): boolean {
  const raw = text(value);
  if (!raw) return true;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return true;
  return t <= Date.now();
}

export async function POST(req: NextRequest) {
  try {
    const serviceSupabase = createServiceSupabase();
    const body = await req.json().catch(() => ({}));

    const orderId = text(body?.order_id || body?.orderId || body?.booking_id || body?.bookingId || body?.id);
    const bookingCode = text(body?.booking_code || body?.bookingCode || body?.code);
    const confirm = body?.confirm === true || lower(body?.action) === "confirm";

    if (!confirm) {
      return json(400, { ok: false, error: "CONFIRM_REQUIRED", message: "confirm=true is required." });
    }

    if (!orderId && !bookingCode) {
      return json(400, { ok: false, error: "ORDER_REQUIRED", message: "order_id or booking_code is required." });
    }

    let q = serviceSupabase
      .from("bookings")
      .select("id,booking_code,service_type,assigned_driver_id,vendor_status,customer_status,takeout_pricing_status,takeout_delivery_fee,takeout_service_fee,takeout_total_payable,takeout_cash_collection_required,takeout_fee_proposed_by_driver_id,takeout_fee_proposed_at,takeout_fee_expires_at,takeout_customer_confirmed_at")
      .eq("service_type", "takeout")
      .limit(1);

    if (orderId) q = q.eq("id", orderId);
    else q = q.eq("booking_code", bookingCode);

    const orderRes = await q.maybeSingle();
    if (orderRes.error) {
      return json(500, { ok: false, error: "TAKEOUT_CONFIRM_QUERY_FAILED", message: orderRes.error.message });
    }

    const order = orderRes.data as any;
    if (!order?.id) {
      return json(404, { ok: false, error: "TAKEOUT_ORDER_NOT_FOUND", message: "Takeout order not found." });
    }

    if (text(order.assigned_driver_id)) {
      return json(409, { ok: false, error: "TAKEOUT_ALREADY_ASSIGNED", message: "Takeout order already has an assigned driver." });
    }

    if (lower(order.takeout_pricing_status) !== "driver_fee_proposed") {
      return json(409, { ok: false, error: "TAKEOUT_FEE_NOT_READY", message: "No active driver delivery fee proposal to confirm." });
    }

    const proposedDriverId = text(order.takeout_fee_proposed_by_driver_id);
    if (!proposedDriverId) {
      return json(409, { ok: false, error: "TAKEOUT_PROPOSING_DRIVER_MISSING", message: "Driver proposal is missing." });
    }

    if (isExpired(order.takeout_fee_expires_at)) {
      await serviceSupabase
        .from("bookings")
        .update({ takeout_pricing_status: "expired" })
        .eq("id", order.id)
        .eq("service_type", "takeout")
        .is("assigned_driver_id", null);

      return json(409, { ok: false, error: "TAKEOUT_FEE_PROPOSAL_EXPIRED", message: "Delivery fee proposal expired. Please wait for a new proposal." });
    }

    const nowIso = new Date().toISOString();

    // JRIDE_TAKEOUT_CONFIRM_FEE_ROUTE_V1
    // Takeout-only customer confirmation. This is the first point where the proposing driver is assigned.
    // No ride fare fields, ride lifecycle fields, wallet fields, or admin trip monitor logic are touched here.
    const updateRes = await serviceSupabase
      .from("bookings")
      .update({
        assigned_driver_id: proposedDriverId,
        takeout_pricing_status: "customer_confirmed",
        takeout_customer_confirmed_at: nowIso,
        vendor_status: "driver_assigned",
        customer_status: "driver_assigned",
      })
      .eq("id", order.id)
      .eq("service_type", "takeout")
      .eq("takeout_pricing_status", "driver_fee_proposed")
      .is("assigned_driver_id", null)
      .select("id,booking_code,service_type,assigned_driver_id,vendor_status,customer_status,takeout_pricing_status,takeout_delivery_fee,takeout_service_fee,takeout_total_payable,takeout_cash_collection_required,takeout_fee_proposed_by_driver_id,takeout_fee_proposed_at,takeout_fee_expires_at,takeout_customer_confirmed_at")
      .single();

    if (updateRes.error) {
      return json(500, { ok: false, error: "TAKEOUT_CONFIRM_UPDATE_FAILED", message: updateRes.error.message });
    }

    return json(200, {
      ok: true,
      order: updateRes.data,
      guard: "takeout_confirm_fee_v1_no_ride_fare_no_wallet",
    });
  } catch (err: any) {
    return json(500, { ok: false, error: "TAKEOUT_CONFIRM_FEE_FAILED", message: err?.message || "Failed to confirm takeout delivery fee." });
  }
}
