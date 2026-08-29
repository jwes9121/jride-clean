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
  const offerId = text(body?.offer_id || body?.offerId);
  const decision = text(body?.decision).toLowerCase();
  const explicitDriverId = text(body?.driver_id || body?.driverId);

  if (!offerId || !["accept", "decline"].includes(decision)) {
    return nativeTestJson(400, { ok: false, error: "NATIVE_TEST_OFFER_AND_DECISION_REQUIRED" });
  }

  const identity = await resolveDriverRequest(req, explicitDriverId);
  if (!identity.ok || !identity.driverId) {
    return nativeTestJson(identity.status || 401, { ok: false, error: identity.error || "NOT_AUTHED" });
  }

  const driverId = identity.driverId;
  const admin = supabaseAdmin();
  const offerRes = await admin
    .from("agrimarket_driver_offers")
    .select("id,order_id,driver_id,status,expires_at,pickup_road_distance_km,pickup_distance_fee")
    .eq("id", offerId)
    .eq("driver_id", driverId)
    .limit(1)
    .maybeSingle();

  if (offerRes.error || !offerRes.data) {
    return nativeTestJson(404, { ok: false, error: "NATIVE_TEST_OFFER_NOT_FOUND", message: offerRes.error?.message });
  }

  const offer: any = offerRes.data;
  const orderRes = await admin
    .from("agrimarket_orders")
    .select("id,order_code,status,preferred_vehicle_type,assigned_driver_id")
    .eq("id", offer.order_id)
    .limit(1)
    .maybeSingle();

  if (orderRes.error || !orderRes.data || String((orderRes.data as any).order_code) !== nativeTestOrderCode(driverId)) {
    return nativeTestJson(403, { ok: false, error: "NATIVE_TEST_ORDER_MISMATCH", message: orderRes.error?.message });
  }

  const order: any = orderRes.data;
  if (text(offer.status) !== "offered") {
    return nativeTestJson(409, { ok: false, error: "NATIVE_TEST_OFFER_NOT_ACTIVE", status: offer.status });
  }
  if (Date.parse(text(offer.expires_at)) <= Date.now()) {
    return nativeTestJson(409, { ok: false, error: "NATIVE_TEST_OFFER_EXPIRED" });
  }

  const nowIso = new Date().toISOString();
  if (decision === "decline") {
    const declineOffer = await admin
      .from("agrimarket_driver_offers")
      .update({ status: "declined", responded_at: nowIso, reason_code: "native_test_driver_declined", updated_at: nowIso })
      .eq("id", offer.id);
    if (declineOffer.error) return nativeTestJson(500, { ok: false, error: "NATIVE_TEST_DECLINE_FAILED", message: declineOffer.error.message });

    const cancelOrder = await admin
      .from("agrimarket_orders")
      .update({ status: "cancelled", cancelled_at: nowIso, cancel_reason: "native_test_driver_declined", updated_at: nowIso })
      .eq("id", order.id);
    if (cancelOrder.error) return nativeTestJson(500, { ok: false, error: "NATIVE_TEST_CANCEL_FAILED", message: cancelOrder.error.message });

    return nativeTestJson(200, { ok: true, native_driver_test: true, decision: "decline", test_complete: true });
  }

  if (order.assigned_driver_id && text(order.assigned_driver_id) !== driverId) {
    return nativeTestJson(409, { ok: false, error: "NATIVE_TEST_ALREADY_ASSIGNED" });
  }

  const acceptOffer = await admin
    .from("agrimarket_driver_offers")
    .update({ status: "accepted", responded_at: nowIso, reason_code: "native_test_driver_accepted", updated_at: nowIso })
    .eq("id", offer.id);
  if (acceptOffer.error) return nativeTestJson(500, { ok: false, error: "NATIVE_TEST_ACCEPT_FAILED", message: acceptOffer.error.message });

  const assignOrder = await admin
    .from("agrimarket_orders")
    .update({
      status: "driver_assigned",
      assigned_driver_id: driverId,
      selected_vehicle_type: order.preferred_vehicle_type,
      dispatch_started_at: nowIso,
      driver_to_first_pickup_km: Number(offer.pickup_road_distance_km || 0),
      pickup_distance_fee: 0,
      pickup_fee_locked_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", order.id);

  if (assignOrder.error) {
    return nativeTestJson(500, { ok: false, error: "NATIVE_TEST_ASSIGN_FAILED", message: assignOrder.error.message });
  }

  return nativeTestJson(200, {
    ok: true,
    native_driver_test: true,
    decision: "accept",
    order_code: order.order_code,
    next: "fetch_current_agrimarket_order",
    test_warning: "TEST ONLY - NO REAL GOODS OR MONEY",
  });
}
