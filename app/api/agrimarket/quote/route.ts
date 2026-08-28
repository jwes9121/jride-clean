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

    const farmerToCustomer = await fetchAgrimarketDrivingRoute(
      context.producer.pickup_lat,
      context.producer.pickup_lng,
      context.address.lat,
      context.address.lng
    );

    const cashCollectionRequired = context.productSubtotal > AGRIMARKET_CASH_FIRST_THRESHOLD;
    const customerToFarmer = cashCollectionRequired
      ? await fetchAgrimarketDrivingRoute(
          context.address.lat,
          context.address.lng,
          context.producer.pickup_lat,
          context.producer.pickup_lng
        )
      : null;

    const serviceDistanceKm = roundMoney(
      farmerToCustomer.distanceKm + (customerToFarmer?.distanceKm || 0)
    );
    const serviceDurationSeconds =
      farmerToCustomer.durationSeconds + (customerToFarmer?.durationSeconds || 0);

    const quoteRes = await admin.rpc("agrimarket_quote_delivery_v1", {
      p_route_distance_km: serviceDistanceKm,
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
    const totalBeforePickupSurcharge = roundMoney(context.productSubtotal + deliveryFee);

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
      cash_collection: {
        threshold_php: AGRIMARKET_CASH_FIRST_THRESHOLD,
        rule: "product_subtotal_over_500_customer_cash_first",
        required: cashCollectionRequired,
        amount: cashCollectionRequired ? context.productSubtotal : 0,
      },
      route_plan: cashCollectionRequired ? "customer_cash_first" : "farmer_first",
      assignment_anchor: cashCollectionRequired ? "customer" : "farmer",
      delivery: {
        base_fee: Number(quote.base_delivery_fee || 0),
        rate_per_km: Number(quote.route_fee_per_km || 0),
        service_route_distance_km: Number(quote.route_distance_km || serviceDistanceKm),
        service_route_duration_seconds: serviceDurationSeconds,
        distance_fee: Number(quote.route_distance_fee || 0),
        delivery_fee: deliveryFee,
        route_provider: farmerToCustomer.provider,
        legs: cashCollectionRequired
          ? [
              {
                from: "customer",
                to: "farmer",
                distance_km: customerToFarmer?.distanceKm || 0,
                duration_seconds: customerToFarmer?.durationSeconds || 0,
              },
              {
                from: "farmer",
                to: "customer",
                distance_km: farmerToCustomer.distanceKm,
                duration_seconds: farmerToCustomer.durationSeconds,
              },
            ]
          : [
              {
                from: "farmer",
                to: "customer",
                distance_km: farmerToCustomer.distanceKm,
                duration_seconds: farmerToCustomer.durationSeconds,
              },
            ],
      },
      pickup_distance_surcharge: {
        status: "pending_driver_assignment",
        current_fee: 0,
        first_km_free: RIDE_PICKUP_FREE_KM,
        normal_assignment_max_km: RIDE_PICKUP_NORMAL_MAX_KM,
        normal_max_fee: RIDE_PICKUP_NORMAL_MAX_FEE,
        distance_basis: "driver_to_first_pickup_road_route",
        first_pickup: cashCollectionRequired ? "customer" : "farmer",
      },
      handling_fee_at_checkout: 0,
      handling_eligible: context.handlingEligible,
      total_before_driver_pickup_surcharge: totalBeforePickupSurcharge,
      final_total_status: "pickup_surcharge_pending_driver_assignment",
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
