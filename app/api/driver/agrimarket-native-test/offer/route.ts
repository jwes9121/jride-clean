import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import {
  ensureNativeDriverTestFixture,
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

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function requiredChecks(item: any): string[] {
  const checks = ["quantity"];
  if (text(item?.condition_required).toLowerCase() !== "normal") checks.push("condition");
  if (["bulk_sack", "crate", "live_fish", "live_poultry", "live_livestock"].includes(text(item?.cargo_class).toLowerCase())) {
    checks.push("cargo");
  }
  return checks;
}

function nextDriverAction(order: any): string | null {
  const status = text(order?.status).toLowerCase();
  if (status === "driver_assigned") {
    if (Boolean(order?.cash_collection_required) && !order?.customer_cash_collected_at) return "collect_customer_cash";
    if (!order?.producer_paid_at) return "pay_farmer";
    return "verify_pickup";
  }
  if (status === "picked_up") return "start_delivery";
  if (status === "delivering") return "confirm_delivery";
  if (status === "delivered") return "retry_settlement";
  return null;
}

export async function GET(req: Request) {
  if (!nativeDriverTestAuthorized(req)) {
    return nativeTestJson(404, { ok: false, error: "NATIVE_TEST_NOT_AVAILABLE" });
  }

  const url = new URL(req.url);
  const explicitDriverId = text(url.searchParams.get("driver_id") || url.searchParams.get("driverId"));
  const identity = await resolveDriverRequest(req, explicitDriverId);
  if (!identity.ok || !identity.driverId) {
    return nativeTestJson(identity.status || 401, { ok: false, error: identity.error || "NOT_AUTHED" });
  }

  const driverId = identity.driverId;
  const fixture = await ensureNativeDriverTestFixture(driverId);
  if (!fixture.ok) return nativeTestJson(409, fixture);
  if (fixture.complete) {
    return nativeTestJson(200, {
      ok: true,
      state: "none",
      offer: null,
      order: null,
      native_driver_test: true,
      test_complete: true,
      message: "Native Agrimarket test completed. No new fixture is created until cleanup.",
    });
  }

  const admin = supabaseAdmin();
  const orderCode = nativeTestOrderCode(driverId);
  const orderRes = await admin
    .from("agrimarket_orders")
    .select("*")
    .eq("order_code", orderCode)
    .limit(1)
    .maybeSingle();

  if (orderRes.error || !orderRes.data) {
    return nativeTestJson(500, { ok: false, error: "NATIVE_TEST_ORDER_READ_FAILED", message: orderRes.error?.message });
  }

  const order: any = orderRes.data;
  const itemsRes = await admin
    .from("agrimarket_order_items")
    .select("id,product_name,product_group,species,breed,meat_cut,processing_form,condition_required,cargo_class,selling_unit,quantity,handling_eligible")
    .eq("order_id", order.id)
    .order("created_at", { ascending: true });

  if (itemsRes.error) {
    return nativeTestJson(500, { ok: false, error: "NATIVE_TEST_ITEM_READ_FAILED", message: itemsRes.error.message });
  }
  const items = Array.isArray(itemsRes.data) ? itemsRes.data : [];

  if (!order.assigned_driver_id) {
    const offerRes = await admin
      .from("agrimarket_driver_offers")
      .select("id,offer_rank,assignment_anchor,pickup_road_distance_km,pickup_distance_fee,estimated_seconds_to_first_pickup,estimated_seconds_to_farmer,offered_at,expires_at")
      .eq("order_id", order.id)
      .eq("driver_id", driverId)
      .eq("status", "offered")
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();

    if (offerRes.error || !offerRes.data) {
      return nativeTestJson(200, { ok: true, state: "none", offer: null, order: null, native_driver_test: true });
    }

    const offer: any = offerRes.data;
    return nativeTestJson(200, {
      ok: true,
      auth_mode: identity.authMode,
      state: "offered",
      native_driver_test: true,
      test_warning: "TEST ONLY - NO REAL GOODS OR MONEY",
      offer: {
        offer_id: offer.id,
        order_code: order.order_code,
        offer_rank: offer.offer_rank,
        assignment_anchor: "farmer",
        first_pickup: "farmer",
        pickup_area: "JRide NATIVE TEST",
        pickup_road_distance_km: num(offer.pickup_road_distance_km),
        pickup_distance_fee: 0,
        eta_seconds_to_first_pickup: num(offer.estimated_seconds_to_first_pickup),
        eta_seconds_to_farmer: num(offer.estimated_seconds_to_farmer),
        route_plan: "farmer_first",
        cash_collection_required: false,
        cash_collection_amount: 0,
        driver_cash_advance_required: true,
        farmer_payment_amount: 0,
        preferred_vehicle_type: order.preferred_vehicle_type,
        required_vehicle_type: order.required_vehicle_type,
        service_route_distance_km: num(order.route_distance_km),
        service_route_duration_seconds: num(order.route_duration_seconds),
        estimated_driver_earnings_before_handling: 0,
        handling_may_apply: false,
        items: items.map((item: any) => ({
          product_name: item.product_name,
          product_group: item.product_group,
          species: item.species,
          breed: item.breed,
          meat_cut: item.meat_cut,
          condition_required: item.condition_required,
          cargo_class: item.cargo_class,
          selling_unit: item.selling_unit,
          quantity: num(item.quantity),
          handling_eligible: false,
          required_pickup_checks: requiredChecks(item),
          live_at_pickup_check_required: false,
        })),
        offered_at: offer.offered_at,
        expires_at: offer.expires_at,
      },
      privacy: {
        farmer_identity_revealed: false,
        farmer_exact_location_revealed: false,
        customer_exact_location_revealed: false,
      },
    });
  }

  if (text(order.assigned_driver_id) !== driverId) {
    return nativeTestJson(403, { ok: false, error: "NATIVE_TEST_ORDER_ASSIGNED_TO_OTHER_DRIVER" });
  }

  const [producerRes, checksRes] = await Promise.all([
    admin
      .from("agrimarket_producers")
      .select("contact_name,town,barangay,pickup_label,pickup_lat,pickup_lng")
      .eq("id", order.producer_id)
      .limit(1)
      .maybeSingle(),
    admin
      .from("agrimarket_pickup_checks")
      .select("order_item_id,check_type,result,observed_condition,notes,checked_at")
      .eq("order_id", order.id)
      .eq("driver_id", driverId),
  ]);

  if (producerRes.error || !producerRes.data || checksRes.error) {
    return nativeTestJson(500, {
      ok: false,
      error: "NATIVE_TEST_ASSIGNED_DETAIL_FAILED",
      message: producerRes.error?.message || checksRes.error?.message,
    });
  }

  const checksByItem = new Map<string, any[]>();
  for (const check of (Array.isArray(checksRes.data) ? checksRes.data : []) as any[]) {
    const key = text(check.order_item_id);
    const list = checksByItem.get(key) || [];
    list.push({
      check_type: check.check_type,
      result: check.result,
      observed_condition: check.observed_condition,
      notes: check.notes,
      checked_at: check.checked_at,
    });
    checksByItem.set(key, list);
  }

  const earlierCash = num(order.customer_cash_collected_amount);
  const finalCashDue = Math.max(0, num(order.total_payable) - earlierCash);
  const producer: any = producerRes.data;

  return nativeTestJson(200, {
    ok: true,
    auth_mode: identity.authMode,
    state: "assigned",
    native_driver_test: true,
    test_warning: "TEST ONLY - DO NOT PAY, COLLECT CASH, OR MOVE GOODS",
    order: {
      order_code: order.order_code,
      status: order.status,
      next_action: nextDriverAction(order),
      route_plan: order.route_plan,
      assignment_anchor: order.assignment_anchor,
      cash_collection_required: false,
      cash_collection_amount: 0,
      customer_cash_collected_at: order.customer_cash_collected_at,
      customer_cash_collected_amount: earlierCash,
      driver_cash_advance_required: true,
      farmer_payment_amount: 0,
      producer_paid_at: order.producer_paid_at,
      producer_paid_amount: num(order.producer_paid_amount),
      pickup_distance_fee: 0,
      handling_fee: 0,
      handling_reason: null,
      handling_locked: order.handling_locked_at != null,
      total_payable: 0,
      final_cash_due: finalCashDue,
      final_cash_collected_at: order.final_cash_collected_at,
      final_cash_collected_amount: num(order.final_cash_collected_amount),
      wallet_settlement_status: order.wallet_settlement_status,
      wallet_settlement_amount: 0,
      wallet_settlement_error: order.wallet_settlement_error,
      farmer: {
        name: producer.contact_name,
        town: producer.town,
        barangay: producer.barangay,
        pickup_label: producer.pickup_label,
        lat: num(producer.pickup_lat),
        lng: num(producer.pickup_lng),
      },
      customer_delivery: {
        label: order.delivery_label,
        lat: num(order.delivery_lat),
        lng: num(order.delivery_lng),
      },
      preferred_vehicle_type: order.preferred_vehicle_type,
      required_vehicle_type: order.required_vehicle_type,
      items: items.map((item: any) => ({
        ...item,
        required_pickup_checks: requiredChecks(item),
        live_at_pickup_check_required: false,
        pickup_checks: checksByItem.get(text(item.id)) || [],
      })),
      ready_at: order.ready_at,
    },
    privacy: {
      farmer_identity_revealed: true,
      exact_locations_revealed_to_assigned_driver_only: true,
      native_test_only: true,
    },
  });
}
