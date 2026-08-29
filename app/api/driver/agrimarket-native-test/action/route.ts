import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import {
  nativeDriverTestAuthorized,
  nativeTestJson,
  nativeTestOrderCode,
} from "../_lib";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export async function POST(req: Request) {
  if (!nativeDriverTestAuthorized(req)) {
    return nativeTestJson(404, { ok: false, error: "NATIVE_TEST_NOT_AVAILABLE" });
  }

  const body = await req.json().catch(() => ({}));
  const orderCode = text(body?.order_code || body?.orderCode);
  const action = text(body?.action).toLowerCase();
  const explicitDriverId = text(body?.driver_id || body?.driverId);
  const payload = body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
    ? body.payload
    : {};

  if (!orderCode || !action) {
    return nativeTestJson(400, { ok: false, error: "NATIVE_TEST_ORDER_AND_ACTION_REQUIRED" });
  }

  const identity = await resolveDriverRequest(req, explicitDriverId);
  if (!identity.ok || !identity.driverId) {
    return nativeTestJson(identity.status || 401, { ok: false, error: identity.error || "NOT_AUTHED" });
  }

  const driverId = identity.driverId;
  if (orderCode !== nativeTestOrderCode(driverId)) {
    return nativeTestJson(403, { ok: false, error: "NATIVE_TEST_ORDER_MISMATCH" });
  }

  if (action === "set_handling_fee") {
    return nativeTestJson(409, {
      ok: false,
      error: "NATIVE_TEST_HANDLING_DISABLED",
      message: "Paid handling is intentionally disabled in the zero-money native test.",
    });
  }

  const allowed = new Set([
    "collect_customer_cash",
    "pay_farmer",
    "verify_item",
    "confirm_pickup",
    "start_delivery",
    "confirm_delivery",
    "retry_settlement",
  ]);
  if (!allowed.has(action)) {
    return nativeTestJson(400, { ok: false, error: "NATIVE_TEST_ACTION_NOT_ALLOWED" });
  }

  const admin = supabaseAdmin();
  const orderRes = await admin
    .from("agrimarket_orders")
    .select("id,order_code,assigned_driver_id,pricing_snapshot")
    .eq("order_code", orderCode)
    .limit(1)
    .maybeSingle();

  if (orderRes.error || !orderRes.data) {
    return nativeTestJson(404, { ok: false, error: "NATIVE_TEST_ORDER_NOT_FOUND", message: orderRes.error?.message });
  }

  const order: any = orderRes.data;
  const snapshot = order.pricing_snapshot && typeof order.pricing_snapshot === "object" ? order.pricing_snapshot : {};
  if (snapshot?.native_driver_test !== true || text(snapshot?.native_test_driver_id) !== driverId) {
    return nativeTestJson(403, { ok: false, error: "NATIVE_TEST_ORDER_NOT_TAGGED" });
  }
  if (text(order.assigned_driver_id) !== driverId) {
    return nativeTestJson(403, { ok: false, error: "NATIVE_TEST_ORDER_NOT_ASSIGNED" });
  }

  const safePayload = { ...payload } as Record<string, unknown>;
  if (["collect_customer_cash", "pay_farmer", "confirm_delivery"].includes(action)) {
    safePayload.amount = 0;
  }

  const resultRes = await admin.rpc("agrimarket_driver_execute_v1", {
    p_order_code: orderCode,
    p_driver_id: driverId,
    p_action: action,
    p_payload: safePayload,
    p_now: new Date().toISOString(),
  });

  if (resultRes.error) {
    return nativeTestJson(500, {
      ok: false,
      error: "NATIVE_TEST_ACTION_RPC_FAILED",
      message: resultRes.error.message,
    });
  }

  const result: any = resultRes.data || {};
  if (result.ok === false) {
    return nativeTestJson(409, { ...result, ok: false, native_driver_test: true });
  }

  return nativeTestJson(200, {
    ...result,
    ok: true,
    native_driver_test: true,
    money_mode: "zero_only",
    test_warning: "TEST ONLY - NO REAL GOODS OR MONEY",
  });
}
