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

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function POST(req: NextRequest) {
  if (!agrimarketEnabled()) return agrimarketDisabledResponse();

  try {
    const passengerAuth = await requireAgrimarketPassenger(req);
    if (passengerAuth.ok === false) return passengerAuth.response;

    const body = await req.json().catch(() => ({}));
    const addressId = normalizeAgrimarketAddressId(body);
    const items = normalizeAgrimarketItems(body);
    const preferredVehicleType = normalizeAgrimarketPreferredVehicle(body);
    const admin = createServiceSupabase();

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

    const quoteRes = await admin.rpc("agrimarket_quote_delivery_v1", {
      p_route_distance_km: route.distanceKm,
    });

    if (quoteRes.error) {
      return jsonNoStore(503, {
        ok: false,
        error: "AGRIMARKET_PRICING_FAILED",
        message: quoteRes.error.message,
      });
    }

    const quoteRows = Array.isArray(quoteRes.data) ? quoteRes.data : [];
    const quote: any = quoteRows[0] || quoteRes.data || null;
    if (!quote) {
      return jsonNoStore(503, {
        ok: false,
        error: "AGRIMARKET_PRICING_UNAVAILABLE",
        message: "Agrimarket pricing is temporarily unavailable.",
      });
    }

    const deliveryFee = Number(quote.delivery_fee || 0);
    const totalAtCheckout = roundMoney(context.productSubtotal + deliveryFee);

    return jsonNoStore(200, {
      ok: true,
      pricing_version: Number(quote.pricing_version || 1),
      currency: String(quote.currency || "PHP"),
      address: {
        id: context.address.id,
        label: context.address.label || context.address.address_text,
      },
      items: context.itemSnapshots,
      product_subtotal: context.productSubtotal,
      delivery: {
        base_fee: Number(quote.base_delivery_fee || 0),
        route_distance_km: Number(quote.route_distance_km || route.distanceKm),
        rate_per_km: Number(quote.route_fee_per_km || 0),
        distance_fee: Number(quote.route_distance_fee || 0),
        delivery_fee: deliveryFee,
        route_duration_seconds: route.durationSeconds,
        route_provider: route.provider,
      },
      handling_fee_at_checkout: 0,
      handling_eligible: context.handlingEligible,
      total_at_checkout: totalAtCheckout,
      preferred_vehicle_type: context.preferredVehicleType,
      required_vehicle_type: context.requiredVehicleType,
      producer_location_disclosure: "hidden",
      producer_marketplace_commission_charged_to_customer: false,
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
      error: routeError ? "AGRIMARKET_ROUTE_FAILED" : "AGRIMARKET_QUOTE_FAILED",
      message,
    });
  }
}
