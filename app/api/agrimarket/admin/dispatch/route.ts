import { NextRequest } from "next/server";
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
    const ordersRes = await admin
      .from("agrimarket_orders")
      .select(
        "id,order_code,producer_id,status,fulfillment_mode,harvest_expected_start_at,harvest_expected_end_at,harvest_ready_at,producer_confirm_expires_at,preparation_minutes,ready_at,product_subtotal,cash_collection_required,cash_collection_amount,route_plan,assignment_anchor,preferred_vehicle_type,required_vehicle_type,route_distance_km,delivery_fee,pickup_distance_fee,handling_fee,total_payable,assigned_driver_id,wallet_settlement_status,wallet_settlement_amount,wallet_settlement_error,created_at,updated_at"
      )
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(100);

    if (ordersRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_ADMIN_DISPATCH_READ_FAILED",
        message: ordersRes.error.message,
      });
    }

    const orders = Array.isArray(ordersRes.data) ? ordersRes.data : [];
    const orderIds = orders.map((row: any) => text(row.id)).filter(Boolean);
    const producerIds = Array.from(new Set(orders.map((row: any) => text(row.producer_id)).filter(Boolean)));

    const [producerRes, offersRes] = await Promise.all([
      producerIds.length
        ? admin
            .from("agrimarket_producers")
            .select("id,town,barangay")
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
    ]);

    if (producerRes.error || offersRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_ADMIN_DISPATCH_DETAIL_FAILED",
        message: producerRes.error?.message || offersRes.error?.message,
      });
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

    const nowMs = Date.now();
    const safeOrders = orders.map((row: any) => {
      const producer = producerById.get(text(row.producer_id));
      const offer = latestOfferByOrder.get(text(row.id));
      const offerDriver = offer ? driverById.get(text(offer.driver_id)) : null;
      const assignedDriver = driverById.get(text(row.assigned_driver_id));
      const expiryMs = offer?.expires_at ? Date.parse(String(offer.expires_at)) : NaN;

      return {
        order_id: row.id,
        order_code: row.order_code,
        status: row.status,
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
