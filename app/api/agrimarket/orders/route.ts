import { NextRequest } from "next/server";
import {
  RIDE_PICKUP_FREE_KM,
  RIDE_PICKUP_NORMAL_MAX_FEE,
  RIDE_PICKUP_NORMAL_MAX_KM,
} from "@/lib/pricing/pickupFee";
import {
  AgrimarketRequestError,
  loadAgrimarketOrderContext,
  normalizeAgrimarketAddressId,
  normalizeAgrimarketItems,
  normalizeAgrimarketPreferredVehicle,
} from "../_lib/order";
import { fetchAgrimarketDrivingRoute } from "../_lib/routing";
import {
  agrimarketDisabledResponse,
  agrimarketEnabled,
  createServiceSupabase,
  jsonNoStore,
  requireAgrimarketPassenger,
} from "../_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const AGRIMARKET_CASH_FIRST_THRESHOLD = 500;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requestId(req: NextRequest, body: any): string {
  const value = String(
    req.headers.get("x-idempotency-key") ||
      body?.request_id ||
      body?.requestId ||
      body?.client_request_id ||
      ""
  ).trim();

  if (!isUuid(value)) {
    throw new AgrimarketRequestError(
      "AGRIMARKET_CLIENT_REQUEST_ID_REQUIRED",
      400,
      "A UUID x-idempotency-key or request_id is required for checkout."
    );
  }
  return value;
}

function rpcFailureStatus(message: string): number {
  if (message.includes("NOT_FOUND")) return 404;
  if (
    message.includes("UNAVAILABLE") ||
    message.includes("INSUFFICIENT") ||
    message.includes("MISMATCH") ||
    message.includes("SINGLE_PRODUCER") ||
    message.includes("SCHEDULED_HARVEST") ||
    message.includes("PRICE_CHANGED_RETRY")
  ) {
    return 409;
  }
  if (message.includes("REQUIRED") || message.includes("INVALID") || message.includes("DUPLICATE")) return 400;
  return 500;
}

function orderPayload(order: any) {
  return {
    order_code: order.order_code,
    status: order.status,
    producer_confirm_expires_at: order.producer_confirm_expires_at,
    product_subtotal: Number(order.product_subtotal || 0),
    cash_collection_required: Boolean(order.cash_collection_required),
    cash_collection_amount: Number(order.cash_collection_amount || 0),
    route_plan: order.route_plan,
    assignment_anchor: order.assignment_anchor,
    delivery_base_fee: Number(order.delivery_base_fee || 0),
    delivery_distance_fee: Number(order.delivery_distance_fee || 0),
    delivery_fee: Number(order.delivery_fee || 0),
    pickup_distance_fee: Number(order.pickup_distance_fee || 0),
    handling_fee: Number(order.handling_fee || 0),
    total_payable: Number(order.total_payable || 0),
    route_distance_km: Number(order.route_distance_km || 0),
    route_duration_seconds: Number(order.route_duration_seconds || 0),
    farmer_to_customer_distance_km: Number(order.farmer_to_customer_distance_km || 0),
    farmer_to_customer_duration_seconds: Number(order.farmer_to_customer_duration_seconds || 0),
    customer_to_farmer_distance_km:
      order.customer_to_farmer_distance_km == null ? null : Number(order.customer_to_farmer_distance_km),
    customer_to_farmer_duration_seconds:
      order.customer_to_farmer_duration_seconds == null ? null : Number(order.customer_to_farmer_duration_seconds),
    driver_to_first_pickup_km:
      order.driver_to_first_pickup_km == null ? null : Number(order.driver_to_first_pickup_km),
    preparation_minutes: Number(order.preparation_minutes || 0),
    preferred_vehicle_type: order.preferred_vehicle_type,
    required_vehicle_type: order.required_vehicle_type,
    pricing_version: Number(order.pricing_version || 1),
  };
}

export async function POST(req: NextRequest) {
  if (!agrimarketEnabled()) return agrimarketDisabledResponse();

  try {
    const passengerAuth = await requireAgrimarketPassenger(req);
    if (passengerAuth.ok === false) return passengerAuth.response;

    const body = await req.json().catch(() => ({}));
    const clientRequestId = requestId(req, body);
    const addressId = normalizeAgrimarketAddressId(body);
    const items = normalizeAgrimarketItems(body);
    const preferredVehicleType = normalizeAgrimarketPreferredVehicle(body);
    const admin = createServiceSupabase();

    const existingRes = await admin
      .from("agrimarket_orders")
      .select(
        "order_code,status,producer_confirm_expires_at,product_subtotal,cash_collection_required,cash_collection_amount,route_plan,assignment_anchor,delivery_base_fee,delivery_distance_fee,delivery_fee,pickup_distance_fee,handling_fee,total_payable,route_distance_km,route_duration_seconds,farmer_to_customer_distance_km,farmer_to_customer_duration_seconds,customer_to_farmer_distance_km,customer_to_farmer_duration_seconds,driver_to_first_pickup_km,preparation_minutes,preferred_vehicle_type,required_vehicle_type,pricing_version"
      )
      .eq("customer_user_id", passengerAuth.user.id)
      .eq("client_request_id", clientRequestId)
      .limit(1)
      .maybeSingle();

    if (existingRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_IDEMPOTENCY_LOOKUP_FAILED",
        message: existingRes.error.message,
      });
    }

    if (existingRes.data) {
      return jsonNoStore(200, {
        ok: true,
        idempotent_replay: true,
        order: orderPayload(existingRes.data),
        pickup_distance_policy: {
          first_km_free: RIDE_PICKUP_FREE_KM,
          normal_assignment_max_km: RIDE_PICKUP_NORMAL_MAX_KM,
          normal_max_fee: RIDE_PICKUP_NORMAL_MAX_FEE,
          distance_basis: "driver_to_first_pickup_road_route",
        },
      });
    }

    const context = await loadAgrimarketOrderContext(
      admin,
      passengerAuth.user.id,
      addressId,
      items,
      preferredVehicleType
    );

    const farmerToCustomer = await fetchAgrimarketDrivingRoute(
      context.producer.pickup_lat,
      context.producer.pickup_lng,
      context.address.lat,
      context.address.lng
    );

    const cashFirst = context.productSubtotal > AGRIMARKET_CASH_FIRST_THRESHOLD;
    const customerToFarmer = cashFirst
      ? await fetchAgrimarketDrivingRoute(
          context.address.lat,
          context.address.lng,
          context.producer.pickup_lat,
          context.producer.pickup_lng
        )
      : null;

    const orderRes = await admin.rpc("agrimarket_create_reserved_order_v3", {
      p_customer_user_id: passengerAuth.user.id,
      p_client_request_id: clientRequestId,
      p_delivery_address_id: addressId,
      p_items: items,
      p_farmer_to_customer_distance_km: farmerToCustomer.distanceKm,
      p_farmer_to_customer_duration_seconds: farmerToCustomer.durationSeconds,
      p_customer_to_farmer_distance_km: customerToFarmer?.distanceKm ?? null,
      p_customer_to_farmer_duration_seconds: customerToFarmer?.durationSeconds ?? null,
      p_preferred_vehicle_type: preferredVehicleType,
      p_route_provider: farmerToCustomer.provider,
    });

    if (orderRes.error) {
      const message = String(orderRes.error.message || "");
      return jsonNoStore(rpcFailureStatus(message), {
        ok: false,
        error: "AGRIMARKET_ORDER_CREATE_FAILED",
        message,
      });
    }

    const rows = Array.isArray(orderRes.data) ? orderRes.data : [];
    const created: any = rows[0] || orderRes.data || null;
    if (!created) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_ORDER_CREATE_EMPTY",
        message: "Agrimarket checkout did not return an order.",
      });
    }

    const readBackRes = await admin
      .from("agrimarket_orders")
      .select(
        "order_code,status,producer_confirm_expires_at,product_subtotal,cash_collection_required,cash_collection_amount,route_plan,assignment_anchor,delivery_base_fee,delivery_distance_fee,delivery_fee,pickup_distance_fee,handling_fee,total_payable,route_distance_km,route_duration_seconds,farmer_to_customer_distance_km,farmer_to_customer_duration_seconds,customer_to_farmer_distance_km,customer_to_farmer_duration_seconds,driver_to_first_pickup_km,preparation_minutes,preferred_vehicle_type,required_vehicle_type,pricing_version"
      )
      .eq("order_code", created.order_code)
      .limit(1)
      .single();

    if (readBackRes.error || !readBackRes.data) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_ORDER_READBACK_FAILED",
        message: readBackRes.error?.message || "Order created but could not be read back.",
      });
    }

    return jsonNoStore(201, {
      ok: true,
      idempotent_replay: false,
      order: orderPayload(readBackRes.data),
      cash_collection_threshold_php: AGRIMARKET_CASH_FIRST_THRESHOLD,
      pickup_distance_policy: {
        status: "pending_driver_assignment",
        first_km_free: RIDE_PICKUP_FREE_KM,
        normal_assignment_max_km: RIDE_PICKUP_NORMAL_MAX_KM,
        normal_max_fee: RIDE_PICKUP_NORMAL_MAX_FEE,
        distance_basis: "driver_to_first_pickup_road_route",
        first_pickup: readBackRes.data.assignment_anchor,
      },
      producer_location_disclosure: "hidden",
      producer_marketplace_commission_charged_to_customer: false,
      confirmation_window_seconds: 300,
    });
  } catch (error: any) {
    if (error instanceof AgrimarketRequestError) {
      return jsonNoStore(error.status, {
        ok: false,
        error: error.code,
        message: error.message,
      });
    }

    const message = String(error?.message || error);
    const routeError = message.startsWith("AGRIMARKET_ROUTE_") || message.includes("MAPBOX");
    return jsonNoStore(routeError ? 502 : 500, {
      ok: false,
      error: routeError ? "AGRIMARKET_ROUTE_FAILED" : "AGRIMARKET_ORDER_CREATE_FAILED",
      message,
    });
  }
}
