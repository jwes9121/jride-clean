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

const AGRIMARKET_CASH_FIRST_THRESHOLD = 500;
const AGRIMARKET_DRIVER_APPROACH_MAX_ASSIGNMENT_KM = 10;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundRouteKm(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function estimateHeavyLoadFee(weightKg: number | null, pricing: any): number | null {
  if (weightKg == null || !Number.isFinite(weightKg) || weightKg <= 0) return null;
  if (weightKg <= num(pricing.heavy_load_exact_tier1_max_kg)) return num(pricing.heavy_load_tier1_fee);
  if (weightKg <= num(pricing.heavy_load_exact_tier2_max_kg)) return num(pricing.heavy_load_tier2_fee);
  if (weightKg <= num(pricing.heavy_load_exact_tier3_max_kg)) return num(pricing.heavy_load_tier3_fee);
  if (weightKg <= num(pricing.heavy_load_exact_tier4_max_kg)) return num(pricing.heavy_load_tier4_fee);
  return null;
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

    const serviceDistanceKm = roundRouteKm(
      farmerToCustomer.distanceKm + (customerToFarmer?.distanceKm || 0)
    );
    const serviceDurationSeconds =
      farmerToCustomer.durationSeconds + (customerToFarmer?.durationSeconds || 0);

    const [quoteRes, pricingRes] = await Promise.all([
      admin.rpc("agrimarket_quote_delivery_v1", {
        p_route_distance_km: serviceDistanceKm,
      }),
      admin
        .from("agrimarket_pricing_settings")
        .select(
          "heavy_load_exact_tier1_max_kg,heavy_load_exact_tier2_max_kg,heavy_load_exact_tier3_max_kg,heavy_load_exact_tier4_max_kg,heavy_load_tier1_fee,heavy_load_tier2_fee,heavy_load_tier3_fee,heavy_load_tier4_fee,special_handling_standard_fee,special_handling_bulky_fee,special_handling_live_single_fee,special_handling_live_difficult_fee,driver_approach_free_km,driver_approach_fee_per_started_km,driver_approach_fee_cap"
        )
        .eq("id", 1)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle(),
    ]);

    if (quoteRes.error || pricingRes.error) {
      return jsonNoStore(503, {
        ok: false,
        error: "AGRIMARKET_PRICING_FAILED",
        message: quoteRes.error?.message || pricingRes.error?.message,
      });
    }

    const quoteRows = Array.isArray(quoteRes.data) ? quoteRes.data : [];
    const quote: any = quoteRows[0] || quoteRes.data || null;
    const pricing: any = pricingRes.data || null;
    if (!quote || !pricing) {
      return jsonNoStore(503, {
        ok: false,
        error: "AGRIMARKET_PRICING_UNAVAILABLE",
        message: "Agrimarket pricing is temporarily unavailable.",
      });
    }

    const deliveryFee = Number(quote.delivery_fee || 0);
    const initialApprovedTotal = roundMoney(context.productSubtotal + deliveryFee);
    const estimatedHeavyLoadFee = estimateHeavyLoadFee(context.estimatedCargoWeightKg, pricing);
    const estimateExceedsV1Limit =
      context.estimatedCargoWeightKg != null &&
      context.estimatedCargoWeightKg > num(pricing.heavy_load_exact_tier4_max_kg);
    const driverApproachPolicy = {
      status: "pending_driver_assignment",
      current_fee: 0,
      first_km_free: num(pricing.driver_approach_free_km),
      fee_per_started_km: num(pricing.driver_approach_fee_per_started_km),
      normal_assignment_max_km: AGRIMARKET_DRIVER_APPROACH_MAX_ASSIGNMENT_KM,
      normal_max_fee: num(pricing.driver_approach_fee_cap),
      distance_basis: "driver_approach_road_route",
      first_pickup: cashCollectionRequired ? "customer" : "farmer",
    };

    return jsonNoStore(200, {
      ok: true,
      pricing_version: Number(quote.pricing_version || 1),
      currency: String(quote.currency || "PHP"),
      address: {
        id: context.address.id,
        label: context.address.label || context.address.address_text,
      },
      items: context.itemSnapshots,
      fulfillment: {
        mode: context.fulfillmentMode,
        is_scheduled_harvest: context.fulfillmentMode === "scheduled_harvest",
        expected_harvest_start_at: context.harvestExpectedStartAt,
        expected_harvest_end_at: context.harvestExpectedEndAt,
        order_cutoff_at: context.harvestOrderCutoffAt,
        customer_reserves_expected_quantity: context.fulfillmentMode === "scheduled_harvest",
        driver_assignment_waits_for_farmer_ready: context.fulfillmentMode === "scheduled_harvest",
      },
      product_subtotal: context.productSubtotal,
      estimated_cargo_weight_kg: context.estimatedCargoWeightKg,
      cargo_weight_estimate_status:
        context.estimatedCargoWeightKg == null
          ? "farmer_confirmation_required"
          : "estimated_from_listing_unit_weights",
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
      heavy_load_fee: {
        status: "pending_farmer_confirmation",
        current_fee: 0,
        estimated_fee: estimatedHeavyLoadFee,
        estimate_basis:
          context.estimatedCargoWeightKg == null
            ? "unavailable"
            : "listing_unit_weight_estimate",
        estimate_exceeds_v1_limit: estimateExceedsV1Limit,
        tiers: [
          { max_kg: num(pricing.heavy_load_exact_tier1_max_kg), fee: num(pricing.heavy_load_tier1_fee) },
          { max_kg: num(pricing.heavy_load_exact_tier2_max_kg), fee: num(pricing.heavy_load_tier2_fee) },
          { max_kg: num(pricing.heavy_load_exact_tier3_max_kg), fee: num(pricing.heavy_load_tier3_fee) },
          { max_kg: num(pricing.heavy_load_exact_tier4_max_kg), fee: num(pricing.heavy_load_tier4_fee) },
        ],
      },
      special_handling_fee: {
        status: "pending_farmer_confirmation",
        current_fee: 0,
        handling_eligible: context.handlingEligible,
        tiers: {
          standard: num(pricing.special_handling_standard_fee),
          bulky: num(pricing.special_handling_bulky_fee),
          live_single: num(pricing.special_handling_live_single_fee),
          live_difficult: num(pricing.special_handling_live_difficult_fee),
        },
      },
      driver_approach_fee: driverApproachPolicy,
      pickup_distance_surcharge: driverApproachPolicy,
      handling_fee_at_checkout: 0,
      handling_eligible: context.handlingEligible,
      initial_approved_total: initialApprovedTotal,
      total_before_driver_pickup_surcharge: initialApprovedTotal,
      final_total_status: "farmer_confirmation_and_driver_approach_pending",
      reapproval_policy: {
        farmer_confirmation_increase_requires_customer_approval: true,
        vehicle_escalation_requires_customer_approval: true,
        driver_approach_fee_finalized_after_assignment: true,
      },
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
