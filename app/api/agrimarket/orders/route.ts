import { NextRequest } from "next/server";
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
    message.includes("SCHEDULED_HARVEST")
  ) {
    return 409;
  }
  if (message.includes("REQUIRED") || message.includes("INVALID") || message.includes("DUPLICATE")) return 400;
  return 500;
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
        "order_code,status,producer_confirm_expires_at,product_subtotal,delivery_base_fee,delivery_distance_fee,delivery_fee,handling_fee,total_payable,route_distance_km,route_duration_seconds,preparation_minutes,preferred_vehicle_type,required_vehicle_type,pricing_version"
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
      const existing: any = existingRes.data;
      return jsonNoStore(200, {
        ok: true,
        idempotent_replay: true,
        order: {
          order_code: existing.order_code,
          status: existing.status,
          producer_confirm_expires_at: existing.producer_confirm_expires_at,
          product_subtotal: Number(existing.product_subtotal || 0),
          delivery_base_fee: Number(existing.delivery_base_fee || 0),
          delivery_distance_fee: Number(existing.delivery_distance_fee || 0),
          delivery_fee: Number(existing.delivery_fee || 0),
          handling_fee: Number(existing.handling_fee || 0),
          total_payable: Number(existing.total_payable || 0),
          route_distance_km: Number(existing.route_distance_km || 0),
          route_duration_seconds: Number(existing.route_duration_seconds || 0),
          preparation_minutes: Number(existing.preparation_minutes || 0),
          preferred_vehicle_type: existing.preferred_vehicle_type,
          required_vehicle_type: existing.required_vehicle_type,
          pricing_version: Number(existing.pricing_version || 1),
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

    const route = await fetchAgrimarketDrivingRoute(
      context.producer.pickup_lat,
      context.producer.pickup_lng,
      context.address.lat,
      context.address.lng
    );

    const orderRes = await admin.rpc("agrimarket_create_reserved_order_v2", {
      p_customer_user_id: passengerAuth.user.id,
      p_client_request_id: clientRequestId,
      p_delivery_address_id: addressId,
      p_items: items,
      p_route_distance_km: route.distanceKm,
      p_route_duration_seconds: route.durationSeconds,
      p_preferred_vehicle_type: preferredVehicleType,
      p_route_provider: route.provider,
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
    const order: any = rows[0] || orderRes.data || null;
    if (!order) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_ORDER_CREATE_EMPTY",
        message: "Agrimarket checkout did not return an order.",
      });
    }

    return jsonNoStore(201, {
      ok: true,
      idempotent_replay: false,
      order: {
        order_code: order.order_code,
        status: order.status,
        producer_confirm_expires_at: order.producer_confirm_expires_at,
        product_subtotal: Number(order.product_subtotal || 0),
        delivery_base_fee: Number(order.delivery_base_fee || 0),
        delivery_distance_fee: Number(order.delivery_distance_fee || 0),
        delivery_fee: Number(order.delivery_fee || 0),
        handling_fee: Number(order.handling_fee || 0),
        total_payable: Number(order.total_payable || 0),
        route_distance_km: Number(order.route_distance_km || route.distanceKm),
        route_duration_seconds: Number(order.route_duration_seconds || route.durationSeconds),
        preparation_minutes: Number(order.preparation_minutes || 0),
        preferred_vehicle_type: order.preferred_vehicle_type,
        required_vehicle_type: order.required_vehicle_type,
        pricing_version: Number(order.pricing_version || 1),
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
