import { agrimarketAdminActions } from "@/lib/agrimarket/adminActions";
import { scheduledHarvestAttention } from "@/lib/agrimarket/harvestAttention";
import { customerDispatchWait, dispatchAttention } from "@/lib/agrimarket/dispatchWait";
import { NextRequest } from "next/server";
import { loadOrderCustomers, nullableNumber } from "@/lib/agrimarket/orderCustomer";
import { offerAgrimarketDriver } from "@/lib/agrimarket/dispatch";
import {
  agrimarketEnabled,
  createServiceSupabase,
  jsonNoStore,
  requireAgrimarketStaff,
} from "../../_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const ACTIVE_STATUSES = [
  "awaiting_producer",
  "awaiting_harvest",
  "producer_accepted",
  "awaiting_customer_reapproval",
  "exception",
  "preparing",
  "ready_for_dispatch",
  "dispatching",
  "driver_assigned",
  "picked_up",
  "delivering",
  "delivered",
];

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uuid(value: unknown): string | null {
  const raw = text(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : null;
}

export async function GET() {
  if (!agrimarketEnabled()) {
    return jsonNoStore(200, { ok: true, enabled: false, orders: [] });
  }

  const staff = await requireAgrimarketStaff(false);
  if (staff.ok === false) return staff.response;

  try {
    const admin = createServiceSupabase();
    const expiry = await admin.rpc("agrimarket_expire_customer_reapproval_v1");
    if (expiry.error) return jsonNoStore(503, { ok: false, error: "AGRIMARKET_TIMEOUT_SWEEP_FAILED" });
    const nowMs = Date.now();
    const orderColumns =
      "id,order_code,producer_id,status,pickup_issue,fulfillment_mode,harvest_expected_start_at,harvest_expected_end_at,harvest_ready_at,producer_confirm_expires_at,preparation_minutes,ready_at,product_subtotal,cash_collection_required,cash_collection_amount,route_plan,assignment_anchor,preferred_vehicle_type,required_vehicle_type,route_distance_km,delivery_fee,pickup_distance_fee,handling_fee,total_payable,assigned_driver_id,dispatch_wait_code,dispatch_wait_vehicle_type,dispatch_checked_at,wallet_settlement_status,wallet_settlement_amount,wallet_settlement_error,created_at,updated_at," +
      "customer_user_id,delivery_address_id,delivery_label,delivery_lat,delivery_lng,route_duration_seconds,farmer_to_customer_distance_km,farmer_to_customer_duration_seconds,customer_to_farmer_distance_km,customer_to_farmer_duration_seconds,driver_to_first_pickup_km,route_provider,selected_vehicle_type,checkout_preferred_vehicle_type,product_required_vehicle_type,delivery_base_fee,delivery_distance_fee,delivery_rate_per_km,heavy_load_fee,handling_reason,pickup_fee_locked_at,driver_delivery_payout,delivery_company_cut,customer_cash_collected_at,customer_cash_collected_amount,producer_paid_at,producer_paid_amount,final_cash_collected_at,final_cash_collected_amount,company_settlement_due,estimated_cargo_weight_kg,confirmed_cargo_weight_kg,confirmed_cargo_weight_basis,confirmed_cargo_weight_band,confirmed_handling_tier,customer_approved_total,customer_approved_vehicle_type,customer_reapproval_required_at,customer_reapproval_expires_at,customer_reapproval_response,customer_reapproval_proposed_total,customer_reapproval_proposed_vehicle_type,dispatch_started_at,picked_up_at,delivering_at,delivered_at,completed_at";
    const [ordersRes, attentionRes] = await Promise.all([
      admin.from("agrimarket_orders").select(orderColumns)
        .in("status", ACTIVE_STATUSES).order("created_at", { ascending: false }).limit(100),
      // Old prepared orders must remain visible even when newer orders fill the usual list.
      admin.from("agrimarket_orders").select(orderColumns)
        .in("status", ["ready_for_dispatch", "dispatching"])
        .is("assigned_driver_id", null)
        .not("dispatch_wait_code", "is", null)
        .lte("ready_at", new Date(nowMs - 15 * 60_000).toISOString())
        .order("ready_at", { ascending: true }).limit(100),
    ]);

    if (ordersRes.error || attentionRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_ADMIN_DISPATCH_READ_FAILED",
        message: ordersRes.error?.message || attentionRes.error?.message,
      });
    }

    const orders = Array.from(new Map(
      [...(Array.isArray(attentionRes.data) ? attentionRes.data : []),
        ...(Array.isArray(ordersRes.data) ? ordersRes.data : [])]
        .map((row: any) => [text(row.id), row])
    ).values());
    const orderIds = orders.map((row: any) => text(row.id)).filter(Boolean);
    const producerIds = Array.from(new Set(orders.map((row: any) => text(row.producer_id)).filter(Boolean)));

    const [producerRes, offersRes, itemsRes, proposalRes, customers] = await Promise.all([
      producerIds.length
        ? admin
            .from("agrimarket_producers")
            .select("id,town,barangay,vendor_name,contact_name")
            .in("id", producerIds)
        : Promise.resolve({ data: [], error: null } as any),
      orderIds.length
        ? admin
            .from("agrimarket_driver_offers")
            .select(
              "id,order_id,driver_id,offer_rank,status,assignment_anchor,pickup_road_distance_km,pickup_distance_fee,estimated_seconds_to_first_pickup,estimated_seconds_to_farmer,offered_at,expires_at,responded_at,reason_code,updated_at"
            )
            .in("order_id", orderIds)
            .order("updated_at", { ascending: false })
        : Promise.resolve({ data: [], error: null } as any),
      orderIds.length
        ? admin.from("agrimarket_order_items")
            .select("order_id,product_id,product_name,product_group,species,breed,meat_cut,processing_form,condition_required,cargo_class,selling_unit,unit_price,quantity,line_total,handling_eligible,availability_mode,harvest_start_at,harvest_end_at,harvest_order_cutoff_at")
            .in("order_id", orderIds).order("created_at", { ascending: true })
        : Promise.resolve({ data: [], error: null } as any),
      orderIds.length
        ? admin.from("agrimarket_harvest_proposals").select("order_id")
            .in("order_id", orderIds).eq("status", "pending_customer")
        : Promise.resolve({ data: [], error: null } as any),
      loadOrderCustomers(admin, orders),
    ]);

    if (producerRes.error || offersRes.error || itemsRes.error || proposalRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_ADMIN_DISPATCH_DETAIL_FAILED",
        message: producerRes.error?.message || offersRes.error?.message || itemsRes.error?.message || proposalRes.error?.message,
      });
    }

    const ordersWithPendingProposal = new Set((proposalRes.data || []).map((row: any) => text(row.order_id)));
    const itemsByOrder = new Map<string, any[]>();
    for (const item of itemsRes.data || []) {
      const list = itemsByOrder.get(item.order_id) || [];
      list.push({ ...item, quantity: nullableNumber(item.quantity), unit_price: nullableNumber(item.unit_price), line_total: nullableNumber(item.line_total) });
      itemsByOrder.set(item.order_id, list);
    }

    const producerById = new Map<string, any>();
    for (const row of Array.isArray(producerRes.data) ? producerRes.data : []) {
      producerById.set(text((row as any).id), row);
    }

    const latestOfferByOrder = new Map<string, any>();
    const driverIds = new Set<string>();
    for (const row of Array.isArray(offersRes.data) ? offersRes.data : []) {
      const orderId = text((row as any).order_id);
      if (orderId && !latestOfferByOrder.has(orderId)) latestOfferByOrder.set(orderId, row);
      const driverId = text((row as any).driver_id);
      if (driverId) driverIds.add(driverId);
    }
    for (const row of orders as any[]) {
      const driverId = text(row.assigned_driver_id);
      if (driverId) driverIds.add(driverId);
    }

    const driverRes = driverIds.size
      ? await admin
          .from("driver_profiles")
          .select("driver_id,full_name,callsign,municipality,vehicle_type")
          .in("driver_id", Array.from(driverIds))
      : ({ data: [], error: null } as any);

    if (driverRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_ADMIN_DRIVER_DETAIL_FAILED",
        message: driverRes.error.message,
      });
    }

    const driverById = new Map<string, any>();
    for (const row of Array.isArray(driverRes.data) ? driverRes.data : []) {
      driverById.set(text((row as any).driver_id), row);
    }

    const safeOrders = orders.map((row: any) => {
      const producer = producerById.get(text(row.producer_id));
      const offer = latestOfferByOrder.get(text(row.id));
      const offerDriver = offer ? driverById.get(text(offer.driver_id)) : null;
      const assignedDriver = driverById.get(text(row.assigned_driver_id));
      const expiryMs = offer?.expires_at ? Date.parse(String(offer.expires_at)) : NaN;

      const activeOffer = (offersRes.data || []).find((candidate: any) => candidate.order_id === row.id && candidate.status === "offered");
      const wait = {
        status: row.status,
        vehicle: row.preferred_vehicle_type,
        code: row.dispatch_wait_code,
        checkedAt: row.dispatch_checked_at,
        checkedVehicle: row.dispatch_wait_vehicle_type,
        readyAt: row.ready_at,
        assignedDriverId: row.assigned_driver_id,
        now: nowMs,
      };
      return {
        admin_actions: agrimarketAdminActions(row, activeOffer?.id || null),
        dispatch_wait: activeOffer ? null : customerDispatchWait(wait),
        dispatch_attention: activeOffer ? null : dispatchAttention(wait),
        customer_reapproval_expires_at: row.customer_reapproval_expires_at || null,
        server_now: new Date(nowMs).toISOString(),
        harvest_attention: scheduledHarvestAttention({ ...row, pending_harvest_proposal: ordersWithPendingProposal.has(text(row.id)) }, nowMs),
        customer: customers.get(row.id) || null,
        items: itemsByOrder.get(row.id) || [],
        details: {
          ...Object.fromEntries([
            "delivery_lat", "delivery_lng", "route_distance_km", "route_duration_seconds",
            "farmer_to_customer_distance_km", "farmer_to_customer_duration_seconds",
            "customer_to_farmer_distance_km", "customer_to_farmer_duration_seconds", "driver_to_first_pickup_km",
            "delivery_base_fee", "delivery_distance_fee", "delivery_rate_per_km", "heavy_load_fee",
            "driver_delivery_payout", "delivery_company_cut", "customer_cash_collected_amount", "producer_paid_amount",
            "final_cash_collected_amount", "company_settlement_due", "estimated_cargo_weight_kg", "confirmed_cargo_weight_kg",
            "customer_approved_total", "customer_reapproval_proposed_total",
          ].map(key => [key, nullableNumber(row[key])])),
          ...Object.fromEntries([
            "route_provider", "selected_vehicle_type", "checkout_preferred_vehicle_type", "product_required_vehicle_type",
            "handling_reason", "pickup_fee_locked_at", "customer_cash_collected_at", "producer_paid_at", "final_cash_collected_at",
            "confirmed_cargo_weight_basis", "confirmed_cargo_weight_band", "confirmed_handling_tier",
            "customer_approved_vehicle_type", "customer_reapproval_required_at", "customer_reapproval_response",
            "customer_reapproval_proposed_vehicle_type", "dispatch_started_at", "picked_up_at", "delivering_at", "delivered_at", "completed_at",
          ].map(key => [key, row[key] ?? null])),
        },
        order_id: row.id,
        order_code: row.order_code,
        status: row.status,
        pickup_issue: row.pickup_issue || null,
        fulfillment_mode: row.fulfillment_mode,
        harvest_expected_start_at: row.harvest_expected_start_at,
        harvest_expected_end_at: row.harvest_expected_end_at,
        harvest_ready_at: row.harvest_ready_at,
        producer_confirm_expires_at: row.producer_confirm_expires_at,
        preparation_minutes: row.preparation_minutes,
        ready_at: row.ready_at,
        product_subtotal: num(row.product_subtotal),
        cash_collection_required: Boolean(row.cash_collection_required),
        cash_collection_amount: num(row.cash_collection_amount),
        route_plan: row.route_plan,
        assignment_anchor: row.assignment_anchor,
        preferred_vehicle_type: row.preferred_vehicle_type,
        required_vehicle_type: row.required_vehicle_type,
        route_distance_km: num(row.route_distance_km),
        delivery_fee: num(row.delivery_fee),
        pickup_distance_fee: num(row.pickup_distance_fee),
        handling_fee: num(row.handling_fee),
        total_payable: num(row.total_payable),
        farmer_area: {
          name: producer?.vendor_name || producer?.contact_name || null,
          town: producer?.town || null,
          barangay: producer?.barangay || null,
        },
        assigned_driver: row.assigned_driver_id
          ? {
              driver_id: row.assigned_driver_id,
              name: assignedDriver?.callsign || assignedDriver?.full_name || row.assigned_driver_id,
              municipality: assignedDriver?.municipality || null,
              vehicle_type: assignedDriver?.vehicle_type || null,
            }
          : null,
        latest_offer: offer
          ? {
              offer_id: offer.id,
              status: offer.status,
              driver_id: offer.driver_id,
              driver_name: offerDriver?.callsign || offerDriver?.full_name || offer.driver_id,
              offer_rank: Number(offer.offer_rank || 1),
              assignment_anchor: offer.assignment_anchor,
              pickup_road_distance_km: num(offer.pickup_road_distance_km),
              pickup_distance_fee: num(offer.pickup_distance_fee),
              eta_seconds_to_first_pickup: num(offer.estimated_seconds_to_first_pickup),
              eta_seconds_to_farmer: num(offer.estimated_seconds_to_farmer),
              offered_at: offer.offered_at,
              expires_at: offer.expires_at,
              seconds_remaining:
                Number.isFinite(expiryMs) && offer.status === "offered"
                  ? Math.max(0, Math.floor((expiryMs - nowMs) / 1000))
                  : 0,
              reason_code: offer.reason_code,
            }
          : null,
        wallet_settlement_status: row.wallet_settlement_status,
        wallet_settlement_amount: num(row.wallet_settlement_amount),
        wallet_settlement_error: row.wallet_settlement_error,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    }).sort((a: any, b: any) => {
      const priority = (value: any) => value.dispatch_attention?.level === "review_required" ? 2
        : value.dispatch_attention?.level === "duty_alert" ? 1 : 0;
      return priority(b) - priority(a) || Date.parse(b.created_at) - Date.parse(a.created_at);
    });

    return jsonNoStore(200, {
      ok: true,
      enabled: true,
      staff_role: staff.role,
      ranking_engine: "server_mapbox_road_route",
      pickup_policy: "shared_jride_first_1_5km_free_then_pickup_surcharge",
      orders: safeOrders,
    });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_ADMIN_DISPATCH_FAILED",
      message: String(error?.message || error),
    });
  }
}

export async function POST(req: NextRequest) {
  if (!agrimarketEnabled()) {
    return jsonNoStore(503, { ok: false, error: "AGRIMARKET_DISABLED" });
  }

  const staff = await requireAgrimarketStaff(true);
  if (staff.ok === false) return staff.response;

  try {
    const body = await req.json().catch(() => ({}));
    const action = text(body?.action || "offer_next").toLowerCase();
    const orderId = uuid(body?.order_id || body?.orderId);
    const orderCode = text(body?.order_code || body?.orderCode);

    if (action === "cancel" || action === "reassign") {
      const note = text(body?.note);
      if (!orderCode || note.length < 5 || note.length > 1000 || !text(body.expected_status)) {
        return jsonNoStore(400, { ok: false, error: "AGRIMARKET_ADMIN_REASON_REQUIRED", message: "Enter a reason of 5 to 1000 characters and refresh the order." });
      }
      const result = await createServiceSupabase().rpc("agrimarket_admin_order_action_v1", {
        p_order_code: orderCode, p_action: action, p_actor: staff.actor, p_note: note,
        p_expected_status: text(body.expected_status), p_expected_driver_id: uuid(body.expected_driver_id),
        p_expected_offer_id: uuid(body.expected_offer_id),
      });
      if (result.error) return jsonNoStore(409, { ok: false, error: "AGRIMARKET_ADMIN_ACTION_FAILED", message: "The action could not be completed. Refresh the order before trying again." });
      if (!result.data?.ok) return jsonNoStore(409, result.data);
      if (action === "reassign") {
        // The release is committed. Report a subsequent matching failure separately.
        try {
          const dispatch = await offerAgrimarketDriver({ orderId: result.data.order_id });
          return jsonNoStore(200, { ...result.data, dispatch });
        } catch {
          return jsonNoStore(200, { ...result.data, dispatch: { ok: false, message: "Previous driver released. Matching will retry automatically." } });
        }
      }
      return jsonNoStore(200, result.data);
    }

    if (action === "resolve_pickup_issue") {
      if (!orderCode) return jsonNoStore(400, { ok: false, error: "AGRIMARKET_ORDER_CODE_REQUIRED" });
      const result = await createServiceSupabase().rpc("agrimarket_admin_resolve_pickup_issue_v1", {
        p_order_code: orderCode,
        p_resolution: text(body?.resolution),
        p_actor: staff.actor,
        p_note: text(body?.note),
        p_now: new Date().toISOString(),
      });
      if (result.error) return jsonNoStore(500, { ok: false, error: "AGRIMARKET_ISSUE_RESOLUTION_FAILED", message: result.error.message });
      return jsonNoStore((result.data as any)?.ok ? 200 : 409, result.data);
    }

    if (action !== "offer_next") {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_ADMIN_DISPATCH_ACTION_INVALID" });
    }
    if (!orderId && !orderCode) {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_ORDER_REQUIRED",
        message: "order_id or order_code is required.",
      });
    }

    const result = await offerAgrimarketDriver({ orderId, orderCode });
    const status = result.ok || result.error === "AGRIMARKET_DISPATCH_TOO_EARLY" ? 200 : 409;

    return jsonNoStore(status, {
      ...result,
      staff_actor: staff.actor,
      ranking_engine: "server_mapbox_road_route",
    });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_ADMIN_DISPATCH_FAILED",
      message: String(error?.message || error),
    });
  }
}
