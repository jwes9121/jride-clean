import { parseUsableCoordinatePair } from "@/lib/location/coordinateValidity";
import {
  getDrivingRoadRoute,
  getDrivingRoadRouteWithGeometry,
  type RoadPoint,
} from "@/lib/routing/mapboxRoad";
import {
  getValidatedCumulativePositiveElevationGain,
  MAPBOX_ELEVATION_SOURCE,
  MAPBOX_ELEVATION_VERSION,
  MAPBOX_FARE_PROVENANCE,
  type ElevationValidationResult,
} from "@/lib/routing/mapboxTerrainElevation";
import {
  computeShortTripAutomaticFare,
  SHORT_TRIP_AUTOMATIC_FARE_VERSION,
  SHORT_TRIP_MAX_ROAD_DISTANCE_KM,
  type ShortTripFareResult,
} from "@/lib/shortTripAutomaticFare";

export const TAKEOUT_AUTOMATIC_DELIVERY_FARE_VERSION =
  "takeout_short_trip_automatic_v1";
export const TAKEOUT_CASH_FIRST_THRESHOLD = 500;
export const TAKEOUT_SERVICE_FEE = 15;

const CUSTOMER_CASH_PICKUP_FREE_KM = 1.5;
const CUSTOMER_CASH_PICKUP_DISTANCE_RATE_PER_500M = 20;
const CUSTOMER_CASH_PICKUP_FIRST_TIER_MAX_KM = 10;
const CUSTOMER_CASH_PICKUP_BEYOND_FIRST_TIER_RATE_PER_KM = 10;
const DRIVER_LOCATION_MAX_AGE_MINUTES = 15;

export type TakeoutRoutePlan = "vendor_first" | "customer_cash_first";

export type TakeoutPickupBreakdown = {
  pickup_distance_km: number | null;
  pickup_free_km: number;
  pickup_billable_excess_km: number;
  pickup_first_tier_km: number;
  pickup_first_tier_units_500m: number;
  pickup_first_tier_fee: number;
  pickup_beyond_first_tier_km: number;
  pickup_beyond_first_tier_units_km: number;
  pickup_beyond_first_tier_fee: number;
  pickup_excess_units_500m: number;
  pickup_excess_fee_per_500m: number;
  pickup_beyond_first_tier_fee_per_km: number;
  pickup_excess_fee: number;
  pickup_distance_source: "not_required" | "mapbox_road";
  computation_status: "not_required" | "computed";
};

export type TakeoutAutomaticDeliveryEvaluation = {
  outcome: "automatic" | "manual" | "retry" | "invalid";
  reason: string | null;
  roadDistanceKm: number | null;
  routePlan: TakeoutRoutePlan | null;
  cashRequired: boolean | null;
  subtotal: number | null;
  packagingSubtotal: number;
  serviceFee: number;
  deliveryFee: number | null;
  totalPayable: number | null;
  pickupBreakdown: TakeoutPickupBreakdown;
  elevation: ElevationValidationResult;
  fare: ShortTripFareResult | null;
  snapshot: Record<string, unknown>;
};

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(v: unknown): number | null {
  const n = num(v);
  if (n === null) return null;
  return Math.round(n * 100) / 100;
}

function roundKm(v: number): number {
  return Math.round(v * 100) / 100;
}

function parsePackagingSubtotalFromText(...values: unknown[]): number {
  const joined = values.map((v) => text(v)).filter(Boolean).join("\n");
  if (!joined) return 0;

  const patterns = [
    /premium packaging[^0-9]*(?:php|p)?\s*([0-9]+(?:\.[0-9]+)?)/i,
    /packaging[^0-9]*(?:php|p)?\s*([0-9]+(?:\.[0-9]+)?)/i,
    /add-on[^0-9]*(?:php|p)?\s*([0-9]+(?:\.[0-9]+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = joined.match(pattern);
    const parsed = match ? money(match[1]) : null;
    if (parsed !== null && parsed > 0) return parsed;
  }
  return 0;
}

function notAttemptedElevation(reason: string): ElevationValidationResult {
  return {
    status: "unavailable",
    source: MAPBOX_ELEVATION_SOURCE,
    version: MAPBOX_ELEVATION_VERSION,
    cumulativePositiveElevationGainM: null,
    samplesRequested: 0,
    samplesUsed: 0,
    filteredOutlierCount: 0,
    validationReason: reason,
  };
}

function noCustomerCashPickupBreakdown(): TakeoutPickupBreakdown {
  return {
    pickup_distance_km: null,
    pickup_free_km: CUSTOMER_CASH_PICKUP_FREE_KM,
    pickup_billable_excess_km: 0,
    pickup_first_tier_km: 0,
    pickup_first_tier_units_500m: 0,
    pickup_first_tier_fee: 0,
    pickup_beyond_first_tier_km: 0,
    pickup_beyond_first_tier_units_km: 0,
    pickup_beyond_first_tier_fee: 0,
    pickup_excess_units_500m: 0,
    pickup_excess_fee_per_500m: CUSTOMER_CASH_PICKUP_DISTANCE_RATE_PER_500M,
    pickup_beyond_first_tier_fee_per_km:
      CUSTOMER_CASH_PICKUP_BEYOND_FIRST_TIER_RATE_PER_KM,
    pickup_excess_fee: 0,
    pickup_distance_source: "not_required",
    computation_status: "not_required",
  };
}

function customerCashPickupFeeBreakdown(
  distanceKmRaw: number
): TakeoutPickupBreakdown {
  const pickupDistanceKm = roundKm(Math.max(0, distanceKmRaw));
  const billableKm = roundKm(
    Math.max(0, pickupDistanceKm - CUSTOMER_CASH_PICKUP_FREE_KM)
  );
  const firstTierKm = roundKm(
    Math.min(billableKm, CUSTOMER_CASH_PICKUP_FIRST_TIER_MAX_KM)
  );
  const beyondFirstTierKm = roundKm(
    Math.max(0, billableKm - CUSTOMER_CASH_PICKUP_FIRST_TIER_MAX_KM)
  );
  const firstTierUnits500m =
    firstTierKm > 0 ? Math.ceil(firstTierKm / 0.5) : 0;
  const firstTierFee =
    firstTierUnits500m * CUSTOMER_CASH_PICKUP_DISTANCE_RATE_PER_500M;
  const beyondFirstTierUnitsKm =
    beyondFirstTierKm > 0 ? Math.ceil(beyondFirstTierKm) : 0;
  const beyondFirstTierFee =
    beyondFirstTierUnitsKm *
    CUSTOMER_CASH_PICKUP_BEYOND_FIRST_TIER_RATE_PER_KM;

  return {
    pickup_distance_km: pickupDistanceKm,
    pickup_free_km: CUSTOMER_CASH_PICKUP_FREE_KM,
    pickup_billable_excess_km: billableKm,
    pickup_first_tier_km: firstTierKm,
    pickup_first_tier_units_500m: firstTierUnits500m,
    pickup_first_tier_fee: money(firstTierFee) as number,
    pickup_beyond_first_tier_km: beyondFirstTierKm,
    pickup_beyond_first_tier_units_km: beyondFirstTierUnitsKm,
    pickup_beyond_first_tier_fee: money(beyondFirstTierFee) as number,
    pickup_excess_units_500m: firstTierUnits500m,
    pickup_excess_fee_per_500m:
      CUSTOMER_CASH_PICKUP_DISTANCE_RATE_PER_500M,
    pickup_beyond_first_tier_fee_per_km:
      CUSTOMER_CASH_PICKUP_BEYOND_FIRST_TIER_RATE_PER_KM,
    pickup_excess_fee: money(firstTierFee + beyondFirstTierFee) as number,
    pickup_distance_source: "mapbox_road",
    computation_status: "computed",
  };
}

function isOnlineLike(value: unknown): boolean {
  const s = text(value).toLowerCase();
  return (
    s === "online" ||
    s === "available" ||
    s === "idle" ||
    s === "waiting"
  );
}

function minutesSince(value: unknown): number {
  const raw = text(value);
  if (!raw) return Number.POSITIVE_INFINITY;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - t) / 60000);
}

function routePlanForSubtotal(subtotal: number): TakeoutRoutePlan {
  return subtotal > TAKEOUT_CASH_FIRST_THRESHOLD
    ? "customer_cash_first"
    : "vendor_first";
}

function buildSnapshot(args: {
  booking: any;
  outcome: TakeoutAutomaticDeliveryEvaluation["outcome"];
  reason: string | null;
  roadDistanceKm: number | null;
  routePlan: TakeoutRoutePlan | null;
  cashRequired: boolean | null;
  subtotal: number | null;
  packagingSubtotal: number;
  deliveryFee: number | null;
  totalPayable: number | null;
  pickupBreakdown: TakeoutPickupBreakdown;
  elevation: ElevationValidationResult;
  fare: ShortTripFareResult | null;
}): Record<string, unknown> {
  const {
    booking,
    outcome,
    reason,
    roadDistanceKm,
    routePlan,
    cashRequired,
    subtotal,
    packagingSubtotal,
    deliveryFee,
    totalPayable,
    pickupBreakdown,
    elevation,
    fare,
  } = args;

  return {
    ...(booking?.takeout_pricing_snapshot &&
    typeof booking.takeout_pricing_snapshot === "object"
      ? booking.takeout_pricing_snapshot
      : {}),
    version: TAKEOUT_AUTOMATIC_DELIVERY_FARE_VERSION,
    ride_formula_version: SHORT_TRIP_AUTOMATIC_FARE_VERSION,
    outcome,
    fallback_reason: reason,
    provenance: MAPBOX_FARE_PROVENANCE,
    food_subtotal: subtotal,
    packaging_subtotal: packagingSubtotal,
    takeout_packaging_subtotal: packagingSubtotal,
    takeout_service_fee: TAKEOUT_SERVICE_FEE,
    takeout_delivery_fee: deliveryFee,
    takeout_total_payable: totalPayable,
    takeout_cash_collection_required: cashRequired,
    takeout_route_plan: routePlan,
    route_plan: routePlan,
    vendor_to_customer_road_distance_km:
      roadDistanceKm == null ? null : Number(roadDistanceKm.toFixed(6)),
    validated_cumulative_positive_elevation_gain_m:
      elevation.cumulativePositiveElevationGainM,
    free_elevation_allowance_m: fare?.freeElevationAllowanceM ?? null,
    chargeable_elevation_gain_m: fare?.chargeableElevationGainM ?? null,
    distance_component: fare?.distanceComponent ?? null,
    elevation_premium: fare?.elevationPremium ?? null,
    automatic_delivery_fee: deliveryFee,
    rounding_version: fare?.roundingVersion ?? null,
    delivery_fare_before_rounding: fare?.rideFareBeforeRounding ?? null,
    delivery_fare_rounding_adjustment:
      fare?.rideFareRoundingAdjustment ?? null,
    elevation_source: elevation.source,
    elevation_version: elevation.version,
    elevation_status: elevation.status,
    elevation_validation_reason: elevation.validationReason,
    takeout_pickup_distance_km: pickupBreakdown.pickup_distance_km,
    takeout_pickup_distance_km_road: pickupBreakdown.pickup_distance_km,
    pickup_distance_km_road: pickupBreakdown.pickup_distance_km,
    takeout_pickup_free_km: pickupBreakdown.pickup_free_km,
    takeout_pickup_billable_excess_km:
      pickupBreakdown.pickup_billable_excess_km,
    pickup_billable_km: pickupBreakdown.pickup_billable_excess_km,
    takeout_pickup_first_tier_km: pickupBreakdown.pickup_first_tier_km,
    pickup_first_tier_km: pickupBreakdown.pickup_first_tier_km,
    takeout_pickup_first_tier_units_500m:
      pickupBreakdown.pickup_first_tier_units_500m,
    takeout_pickup_first_tier_fee: pickupBreakdown.pickup_first_tier_fee,
    takeout_pickup_beyond_first_tier_km:
      pickupBreakdown.pickup_beyond_first_tier_km,
    pickup_second_tier_km: pickupBreakdown.pickup_beyond_first_tier_km,
    takeout_pickup_beyond_first_tier_units_km:
      pickupBreakdown.pickup_beyond_first_tier_units_km,
    takeout_pickup_beyond_first_tier_fee:
      pickupBreakdown.pickup_beyond_first_tier_fee,
    takeout_pickup_excess_units_500m:
      pickupBreakdown.pickup_excess_units_500m,
    takeout_pickup_excess_fee_per_500m:
      pickupBreakdown.pickup_excess_fee_per_500m,
    takeout_pickup_beyond_first_tier_fee_per_km:
      pickupBreakdown.pickup_beyond_first_tier_fee_per_km,
    takeout_pickup_excess_fee: pickupBreakdown.pickup_excess_fee,
    pickup_distance_fee: pickupBreakdown.pickup_excess_fee,
    takeout_pickup_distance_source: pickupBreakdown.pickup_distance_source,
    pickup_distance_source: pickupBreakdown.pickup_distance_source,
    takeout_pickup_computation_status:
      pickupBreakdown.computation_status,
    automatic_pricing: outcome === "automatic",
  };
}

function result(
  booking: any,
  values: Omit<TakeoutAutomaticDeliveryEvaluation, "snapshot">
): TakeoutAutomaticDeliveryEvaluation {
  return {
    ...values,
    snapshot: buildSnapshot({
      booking,
      outcome: values.outcome,
      reason: values.reason,
      roadDistanceKm: values.roadDistanceKm,
      routePlan: values.routePlan,
      cashRequired: values.cashRequired,
      subtotal: values.subtotal,
      packagingSubtotal: values.packagingSubtotal,
      deliveryFee: values.deliveryFee,
      totalPayable: values.totalPayable,
      pickupBreakdown: values.pickupBreakdown,
      elevation: values.elevation,
      fare: values.fare,
    }),
  };
}

export async function evaluateTakeoutAutomaticDeliveryFare(args: {
  booking: any;
  driverId: string;
  supabase: any;
}): Promise<TakeoutAutomaticDeliveryEvaluation> {
  const { booking, driverId, supabase } = args;
  const noPickup = noCustomerCashPickupBreakdown();

  if (text(booking?.service_type).toLowerCase() !== "takeout") {
    return result(booking, {
      outcome: "invalid",
      reason: "service_type_not_takeout",
      roadDistanceKm: null,
      routePlan: null,
      cashRequired: null,
      subtotal: null,
      packagingSubtotal: 0,
      serviceFee: TAKEOUT_SERVICE_FEE,
      deliveryFee: null,
      totalPayable: null,
      pickupBreakdown: noPickup,
      elevation: notAttemptedElevation("service_type_not_takeout"),
      fare: null,
    });
  }

  const subtotal = money(booking?.takeout_items_subtotal);
  if (subtotal == null || subtotal <= 0) {
    return result(booking, {
      outcome: "invalid",
      reason: "takeout_subtotal_missing",
      roadDistanceKm: null,
      routePlan: null,
      cashRequired: null,
      subtotal,
      packagingSubtotal: 0,
      serviceFee: TAKEOUT_SERVICE_FEE,
      deliveryFee: null,
      totalPayable: null,
      pickupBreakdown: noPickup,
      elevation: notAttemptedElevation("takeout_subtotal_missing"),
      fare: null,
    });
  }

  const routePlan = routePlanForSubtotal(subtotal);
  const cashRequired = routePlan === "customer_cash_first";
  const pricingSnapshot =
    booking?.takeout_pricing_snapshot &&
    typeof booking.takeout_pricing_snapshot === "object"
      ? booking.takeout_pricing_snapshot
      : {};
  const snapshotPackaging =
    money(
      pricingSnapshot.packaging_subtotal ??
        pricingSnapshot.takeout_packaging_subtotal ??
        0
    ) ?? 0;
  const notePackaging = parsePackagingSubtotalFromText(
    booking?.customer_note,
    booking?.notes
  );
  const packagingSubtotal = Math.max(
    0,
    snapshotPackaging,
    notePackaging
  );

  const vendor = parseUsableCoordinatePair(
    booking?.pickup_lat,
    booking?.pickup_lng
  );
  const customer = parseUsableCoordinatePair(
    booking?.dropoff_lat,
    booking?.dropoff_lng
  );
  if (!vendor || !customer) {
    return result(booking, {
      outcome: "retry",
      reason: "takeout_route_coordinates_unavailable",
      roadDistanceKm: null,
      routePlan,
      cashRequired,
      subtotal,
      packagingSubtotal,
      serviceFee: TAKEOUT_SERVICE_FEE,
      deliveryFee: null,
      totalPayable: null,
      pickupBreakdown: noPickup,
      elevation: notAttemptedElevation(
        "takeout_route_coordinates_unavailable"
      ),
      fare: null,
    });
  }

  const vendorPoint: RoadPoint = { lat: vendor.lat, lng: vendor.lng };
  const customerPoint: RoadPoint = {
    lat: customer.lat,
    lng: customer.lng,
  };
  const deliveryRoad = await getDrivingRoadRouteWithGeometry(
    vendorPoint,
    customerPoint,
    { overview: "full" }
  );

  if (!deliveryRoad) {
    return result(booking, {
      outcome: "retry",
      reason: "takeout_delivery_road_route_unavailable",
      roadDistanceKm: null,
      routePlan,
      cashRequired,
      subtotal,
      packagingSubtotal,
      serviceFee: TAKEOUT_SERVICE_FEE,
      deliveryFee: null,
      totalPayable: null,
      pickupBreakdown: noPickup,
      elevation: notAttemptedElevation(
        "takeout_delivery_road_route_unavailable"
      ),
      fare: null,
    });
  }

  if (deliveryRoad.distanceKm > SHORT_TRIP_MAX_ROAD_DISTANCE_KM) {
    return result(booking, {
      outcome: "manual",
      reason: "road_distance_above_short_trip_limit",
      roadDistanceKm: deliveryRoad.distanceKm,
      routePlan,
      cashRequired,
      subtotal,
      packagingSubtotal,
      serviceFee: TAKEOUT_SERVICE_FEE,
      deliveryFee: null,
      totalPayable: null,
      pickupBreakdown: noPickup,
      elevation: notAttemptedElevation(
        "road_distance_above_short_trip_limit"
      ),
      fare: null,
    });
  }

  if (!deliveryRoad.geometry) {
    return result(booking, {
      outcome: "retry",
      reason: "takeout_delivery_road_geometry_unavailable",
      roadDistanceKm: deliveryRoad.distanceKm,
      routePlan,
      cashRequired,
      subtotal,
      packagingSubtotal,
      serviceFee: TAKEOUT_SERVICE_FEE,
      deliveryFee: null,
      totalPayable: null,
      pickupBreakdown: noPickup,
      elevation: notAttemptedElevation(
        "takeout_delivery_road_geometry_unavailable"
      ),
      fare: null,
    });
  }

  const elevation = await getValidatedCumulativePositiveElevationGain(
    deliveryRoad.geometry,
    deliveryRoad.distanceKm
  );
  if (
    elevation.status !== "validated" ||
    elevation.cumulativePositiveElevationGainM == null
  ) {
    return result(booking, {
      outcome: "retry",
      reason:
        elevation.status === "invalid"
          ? "takeout_delivery_elevation_invalid"
          : "takeout_delivery_elevation_unavailable",
      roadDistanceKm: deliveryRoad.distanceKm,
      routePlan,
      cashRequired,
      subtotal,
      packagingSubtotal,
      serviceFee: TAKEOUT_SERVICE_FEE,
      deliveryFee: null,
      totalPayable: null,
      pickupBreakdown: noPickup,
      elevation,
      fare: null,
    });
  }

  let pickupBreakdown = noPickup;
  if (cashRequired) {
    const locationRes = await supabase
      .from("driver_locations")
      .select("driver_id,lat,lng,status,updated_at")
      .eq("driver_id", driverId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const location = locationRes?.data || null;
    const driverPoint = parseUsableCoordinatePair(
      location?.lat,
      location?.lng
    );
    if (
      locationRes?.error ||
      !location ||
      !driverPoint ||
      !isOnlineLike(location?.status) ||
      minutesSince(location?.updated_at) > DRIVER_LOCATION_MAX_AGE_MINUTES
    ) {
      return result(booking, {
        outcome: "retry",
        reason: "driver_location_unavailable_for_customer_cash_pickup",
        roadDistanceKm: deliveryRoad.distanceKm,
        routePlan,
        cashRequired,
        subtotal,
        packagingSubtotal,
        serviceFee: TAKEOUT_SERVICE_FEE,
        deliveryFee: null,
        totalPayable: null,
        pickupBreakdown,
        elevation,
        fare: null,
      });
    }

    const customerPickupRoad = await getDrivingRoadRoute(
      { lat: driverPoint.lat, lng: driverPoint.lng },
      customerPoint
    );
    if (!customerPickupRoad) {
      return result(booking, {
        outcome: "retry",
        reason: "customer_cash_pickup_road_route_unavailable",
        roadDistanceKm: deliveryRoad.distanceKm,
        routePlan,
        cashRequired,
        subtotal,
        packagingSubtotal,
        serviceFee: TAKEOUT_SERVICE_FEE,
        deliveryFee: null,
        totalPayable: null,
        pickupBreakdown,
        elevation,
        fare: null,
      });
    }

    pickupBreakdown = customerCashPickupFeeBreakdown(
      customerPickupRoad.distanceKm
    );
  }

  const fare = computeShortTripAutomaticFare({
    roadDistanceKm: deliveryRoad.distanceKm,
    validatedCumulativePositiveElevationGainM:
      elevation.cumulativePositiveElevationGainM,
  });
  const deliveryFee = fare.automaticRideFare;
  const totalPayable = money(
    subtotal +
      packagingSubtotal +
      TAKEOUT_SERVICE_FEE +
      deliveryFee +
      pickupBreakdown.pickup_excess_fee
  ) as number;

  return result(booking, {
    outcome: "automatic",
    reason: null,
    roadDistanceKm: deliveryRoad.distanceKm,
    routePlan,
    cashRequired,
    subtotal,
    packagingSubtotal,
    serviceFee: TAKEOUT_SERVICE_FEE,
    deliveryFee,
    totalPayable,
    pickupBreakdown,
    elevation,
    fare,
  });
}
