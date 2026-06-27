import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

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

function normalizeAction(value: any) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "force_cancel" || s === "cancel" || s === "cancelled" || s === "canceled") return "force_cancel";
  if (s === "force_complete" || s === "complete" || s === "completed") return "force_complete";
  if (s === "reopen" || s === "reopen_preparing" || s === "preparing") return "reopen_preparing";
  return "";
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
  const action = normalizeAction(body?.action);

  if (!orderId) {
    return json(400, { ok: false, error: "order_id_required", message: "order_id required" });
  }

  if (!action) {
    return json(400, { ok: false, error: "bad_action", message: "Unsupported admin takeout action" });
  }

  const patch: Record<string, any> = {};

  if (action === "force_cancel") {
    patch.status = "cancelled";
    patch.vendor_status = "cancelled";
    patch.customer_status = "cancelled";
    patch.driver_status = "cancelled";
    patch.takeout_pricing_status = "cancelled";
    patch.driver_accept_expires_at = null;
    patch.takeout_driver_accept_expires_at = null;
    patch.takeout_fee_proposal_expires_at = null;
    patch.driver_fee_proposal_expires_at = null;
    patch.takeout_fee_expires_at = null;
  } else if (action === "force_complete") {
    patch.status = "completed";
    patch.vendor_status = "completed";
    patch.customer_status = "completed";
    patch.driver_status = "completed";
  } else if (action === "reopen_preparing") {
    patch.status = "requested";
    patch.vendor_status = "preparing";
    patch.customer_status = "requested";
    patch.driver_status = null;
    patch.takeout_pricing_status = null;
    patch.driver_accept_expires_at = null;
    patch.takeout_driver_accept_expires_at = null;
    patch.takeout_fee_proposal_expires_at = null;
    patch.driver_fee_proposal_expires_at = null;
    patch.takeout_fee_expires_at = null;
  }

  const up = await admin
    .from("bookings")
    .update(patch)
    .eq("id", orderId)
    .eq("service_type", "takeout")
    .select("id,booking_code,status,vendor_status,customer_status,driver_status,takeout_pricing_status,updated_at")
    .single();

  if (up.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: up.error.message });
  }

  return json(200, { ok: true, action, order: up.data });
}

