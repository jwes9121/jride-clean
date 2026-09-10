import type { supabaseAdmin } from "@/lib/supabaseAdmin";

type DriverStateRead = { body: any; status: number };
function stateResult(body: any, init: { status: number }): DriverStateRead {
  return { body, status: init.status };
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNum(value: unknown): number | null {
  if (value == null || text(value) === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function requiredChecks(item: any): string[] {
  const checks = ["quantity"];
  if (text(item?.condition_required).toLowerCase() !== "normal") checks.push("condition");
  if (["bulk_sack", "crate", "live_fish", "live_poultry", "live_livestock"].includes(text(item?.cargo_class).toLowerCase())) {
    checks.push("cargo");
  }
  return checks;
}

export function cargoConfirmation(order: any) {
  const basis = text(order?.confirmed_cargo_weight_basis).toLowerCase();
  return {
    weight_basis: basis || null,
    exact_weight_kg: basis === "exact" ? nullableNum(order?.confirmed_cargo_weight_kg) : null,
    weight_band: basis === "approximate" ? text(order?.confirmed_cargo_weight_band) || null : null,
    handling_tier: text(order?.confirmed_handling_tier) || null,
  };
}

function nextDriverAction(order: any): string | null {
  if (order?.pickup_issue?.status === "open") return "resolve_mismatch";
  const status = text(order?.status).toLowerCase();
  if (status === "driver_assigned") {
    if (Boolean(order?.cash_collection_required) && !order?.customer_cash_collected_at) {
      return "collect_customer_cash";
    }
    if (!order?.producer_paid_at) return "pay_farmer";
    return "verify_pickup";
  }
  if (status === "picked_up") return "start_delivery";
  if (status === "delivering") return "confirm_delivery";
  if (status === "delivered") return "retry_settlement";
  return null;
}

// Caller must authenticate first. Both polling and post-save reads enforce
// assigned_driver_id before loading private farmer details or pickup checks.
export async function readAssignedAgrimarketState(
  admin: ReturnType<typeof supabaseAdmin>,
  driverId: string,
  authMode: string | undefined,
  orderCode?: string,
  signal: AbortSignal = new AbortController().signal
): Promise<DriverStateRead> {
  let assignedQuery = admin
    .from("agrimarket_orders")
    .select(
      "id,order_code,producer_id,status,pickup_issue,product_subtotal,producer_product_net,cash_collection_required,cash_collection_amount,customer_cash_collected_at,customer_cash_collected_amount,producer_paid_at,producer_paid_amount,route_plan,assignment_anchor,delivery_label,delivery_lat,delivery_lng,checkout_preferred_vehicle_type,product_required_vehicle_type,preferred_vehicle_type,required_vehicle_type,route_distance_km,route_duration_seconds,pickup_distance_fee,heavy_load_fee,handling_fee,handling_reason,handling_locked_at,driver_delivery_payout,confirmed_cargo_weight_basis,confirmed_cargo_weight_kg,confirmed_cargo_weight_band,confirmed_handling_tier,total_payable,final_cash_collected_at,final_cash_collected_amount,wallet_settlement_status,wallet_settlement_amount,wallet_settlement_error,ready_at"
    )
    .eq("assigned_driver_id", driverId)
    .in("status", ["driver_assigned", "picked_up", "delivering", "delivered"]);
  if (orderCode) assignedQuery = assignedQuery.eq("order_code", orderCode);
  assignedQuery = assignedQuery.abortSignal(signal);
  const assignedRes = await assignedQuery
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (assignedRes.error) {
    return stateResult(
      { ok: false, error: "AGRIMARKET_ACTIVE_ORDER_READ_FAILED", message: assignedRes.error.message },
      { status: 500 }
    );
  }

  if (!assignedRes.data) {
    return stateResult(
      { ok: true, auth_mode: authMode, state: "none", offer: null, order: null },
      { status: 200 }
    );
  }

  const order: any = assignedRes.data;
  const [producerRes, itemsRes, checksRes] = await Promise.all([
    admin
      .from("agrimarket_producers")
      .select("contact_name,vendor_name,contact_phone,town,barangay,pickup_label,pickup_lat,pickup_lng,pickup_motorcycle_accessible,pickup_tricycle_accessible,pickup_roadside_handoff_required,pickup_driver_directions")
      .eq("id", order.producer_id)
      .limit(1)
      .abortSignal(signal)
      .maybeSingle(),
    admin
      .from("agrimarket_order_items")
      .select("id,product_name,product_group,species,breed,meat_cut,processing_form,condition_required,cargo_class,selling_unit,quantity,handling_eligible")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true })
      .abortSignal(signal),
    admin
      .from("agrimarket_pickup_checks")
      .select("order_item_id,check_type,result,observed_condition,notes,checked_at")
      .eq("order_id", order.id)
      .eq("driver_id", driverId)
      .abortSignal(signal),
  ]);

  if (producerRes.error || !producerRes.data || itemsRes.error || checksRes.error) {
    return stateResult(
      {
        ok: false,
        error: "AGRIMARKET_ACTIVE_ORDER_DETAIL_FAILED",
        message: producerRes.error?.message || itemsRes.error?.message || checksRes.error?.message,
      },
      { status: 500 }
    );
  }

  const checksByItem = new Map<string, any[]>();
  for (const check of (Array.isArray(checksRes.data) ? checksRes.data : []) as any[]) {
    const itemId = text(check.order_item_id);
    const list = checksByItem.get(itemId) || [];
    list.push({
      check_type: check.check_type,
      result: check.result,
      observed_condition: check.observed_condition,
      notes: check.notes,
      checked_at: check.checked_at,
    });
    checksByItem.set(itemId, list);
  }

  const earlierCash = num(order.customer_cash_collected_amount);
  const finalCashDue = Math.max(0, num(order.total_payable) - earlierCash);
  const producer: any = producerRes.data;

  return stateResult(
    {
      ok: true,
      auth_mode: authMode,
      state: "assigned",
      order: {
        order_code: order.order_code,
        status: order.status,
        next_action: nextDriverAction(order),
        pickup_issue: order.pickup_issue || null,
        route_plan: order.route_plan,
        assignment_anchor: order.assignment_anchor,
        cash_collection_required: Boolean(order.cash_collection_required),
        cash_collection_amount: num(order.cash_collection_amount),
        customer_cash_collected_at: order.customer_cash_collected_at,
        customer_cash_collected_amount: earlierCash,
        driver_cash_advance_required: !Boolean(order.cash_collection_required),
        farmer_payment_amount: num(order.producer_product_net),
        producer_paid_at: order.producer_paid_at,
        producer_paid_amount: num(order.producer_paid_amount),
        pickup_distance_fee: num(order.pickup_distance_fee),
        heavy_load_fee: num(order.heavy_load_fee),
        handling_fee: num(order.handling_fee),
        special_handling_fee: num(order.handling_fee),
        handling_reason: order.handling_reason,
        handling_locked: order.handling_locked_at != null,
        driver_delivery_payout: num(order.driver_delivery_payout),
        cargo_confirmation: cargoConfirmation(order),
        total_payable: num(order.total_payable),
        final_cash_due: finalCashDue,
        final_cash_collected_at: order.final_cash_collected_at,
        final_cash_collected_amount: num(order.final_cash_collected_amount),
        wallet_settlement_status: order.wallet_settlement_status,
        wallet_settlement_amount: num(order.wallet_settlement_amount),
        wallet_settlement_error: order.wallet_settlement_error,
        farmer: {
          name: text(producer.vendor_name) || producer.contact_name,
          vendor_name: text(producer.vendor_name) || null,
          contact_name: producer.contact_name,
          contact_number: text(producer.contact_phone) || null,
          town: producer.town,
          barangay: producer.barangay,
          pickup_label: producer.pickup_label,
          pickup_notes: text(producer.pickup_driver_directions) || null,
          pickup_driver_directions: text(producer.pickup_driver_directions) || null,
          pickup_motorcycle_accessible: producer.pickup_motorcycle_accessible,
          pickup_tricycle_accessible: producer.pickup_tricycle_accessible,
          pickup_roadside_handoff_required: producer.pickup_roadside_handoff_required,
          lat: num(producer.pickup_lat),
          lng: num(producer.pickup_lng),
        },
        customer_delivery: {
          label: order.delivery_label,
          lat: num(order.delivery_lat),
          lng: num(order.delivery_lng),
        },
        checkout_preferred_vehicle_type: order.checkout_preferred_vehicle_type,
        product_required_vehicle_type: order.product_required_vehicle_type,
        preferred_vehicle_type: order.preferred_vehicle_type,
        required_vehicle_type: order.required_vehicle_type,
        items: (Array.isArray(itemsRes.data) ? itemsRes.data : []).map((item: any) => ({
          ...item,
          required_pickup_checks: requiredChecks(item),
          live_at_pickup_check_required: text(item.condition_required) === "live_at_pickup",
          pickup_checks: checksByItem.get(text(item.id)) || [],
        })),
        ready_at: order.ready_at,
      },
      privacy: {
        farmer_identity_revealed: true,
        farmer_contact_revealed: Boolean(text(producer.contact_phone)),
        exact_locations_revealed_to_assigned_driver_only: true,
        disclosure_to_customer_or_other_parties_prohibited: true,
      },
    },
    { status: 200 }
  );
}
