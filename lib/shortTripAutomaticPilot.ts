import {
  computeRidePickupFee,
  isNormalRidePickupDistance,
  RIDE_PICKUP_NORMAL_MAX_KM,
} from "@/lib/pricing/pickupFee";
import { parseUsableCoordinatePair } from "@/lib/location/coordinateValidity";
import {
  getDrivingRoadRoute,
  getDrivingRoadRouteWithGeometry,
  type RoadPoint,
} from "@/lib/routing/mapboxRoad";
import {
  getValidatedCumulativePositiveElevationGain,
  type ElevationValidationResult,
} from "@/lib/routing/openMeteoElevation";
import {
  computeShortTripAutomaticFare,
  isRegularRideServiceType,
  SHORT_TRIP_AUTOMATIC_FARE_VERSION,
  SHORT_TRIP_MAX_ROAD_DISTANCE_KM,
  type ShortTripFareResult,
} from "@/lib/shortTripAutomaticFare";

export type ShortTripFareEvaluation = {
  outcome: "automatic" | "fallback";
  fallbackReason: string | null;
  roadDistanceKm: number | null;
  driverToPickupKm: number | null;
  pickupEtaMinutes: number | null;
  pickupDistanceFee: number;
  elevation: ElevationValidationResult;
  fare: ShortTripFareResult | null;
  snapshot: Record<string, unknown>;
};

function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

function estimateEtaMinutes(distanceKm: number | null): number | null {
  if (distanceKm == null || distanceKm <= 0) return null;
  return Math.max(1, Math.ceil((distanceKm / 25) * 60));
}

function notAttemptedElevation(reason: string): ElevationValidationResult {
  return {
    status: "unavailable",
    source: "open_meteo_copernicus_glo90",
    version: "open_meteo_elevation_v1",
    cumulativePositiveElevationGainM: null,
    samplesRequested: 0,
    samplesUsed: 0,
    filteredOutlierCount: 0,
    validationReason: reason,
  };
}

function makeSnapshot(
  evaluation: Omit<ShortTripFareEvaluation, "snapshot">,
  reason: string | null
): Record<string, unknown> {
  const fare = evaluation.fare;
  return {
    version: SHORT_TRIP_AUTOMATIC_FARE_VERSION,
    outcome: evaluation.outcome,
    fallback_reason: reason,
    provenance: "mapbox_road_open_meteo_glo90_v1",
    road_distance_km:
      evaluation.roadDistanceKm == null ? null : round(evaluation.roadDistanceKm, 6),
    validated_cumulative_positive_elevation_gain_m:
      evaluation.elevation.cumulativePositiveElevationGainM,
    free_elevation_allowance_m: fare?.freeElevationAllowanceM ?? null,
    chargeable_elevation_gain_m: fare?.chargeableElevationGainM ?? null,
    distance_component: fare?.distanceComponent ?? null,
    elevation_premium: fare?.elevationPremium ?? null,
    ride_minimum_applied: fare?.rideMinimumApplied ?? null,
    passenger_total_minimum_applied: fare?.passengerTotalMinimumApplied ?? null,
    minimum_applied: fare?.minimumApplied ?? null,
    automatic_ride_fare: fare?.automaticRideFare ?? null,
    convenience_fee: fare?.convenienceFee ?? null,
    pickup_distance_km:
      evaluation.driverToPickupKm == null ? null : round(evaluation.driverToPickupKm, 2),
    pickup_distance_fee: evaluation.pickupDistanceFee,
    total: fare?.total ?? null,
    elevation_source: evaluation.elevation.source,
    elevation_version: evaluation.elevation.version,
    elevation_status: evaluation.elevation.status,
    elevation_validation_reason: evaluation.elevation.validationReason,
    elevation_samples_requested: evaluation.elevation.samplesRequested,
    elevation_samples_used: evaluation.elevation.samplesUsed,
    elevation_filtered_outlier_count: evaluation.elevation.filteredOutlierCount,
  };
}

function fallbackEvaluation(
  fallbackReason: string,
  roadDistanceKm: number | null,
  elevation: ElevationValidationResult,
  driverToPickupKm: number | null = null,
  pickupEtaMinutes: number | null = null,
  pickupDistanceFee = 0
): ShortTripFareEvaluation {
  const base: Omit<ShortTripFareEvaluation, "snapshot"> = {
    outcome: "fallback",
    fallbackReason,
    roadDistanceKm,
    driverToPickupKm,
    pickupEtaMinutes,
    pickupDistanceFee,
    elevation,
    fare: null,
  };
  return { ...base, snapshot: makeSnapshot(base, fallbackReason) };
}

export async function evaluateShortTripAutomaticFare(args: {
  booking: any;
  driverId: string;
  supabase: any;
}): Promise<ShortTripFareEvaluation> {
  const { booking, driverId, supabase } = args;
  if (!isRegularRideServiceType(booking?.service_type)) {
    return fallbackEvaluation(
      "service_type_not_regular_ride",
      null,
      notAttemptedElevation("service_type_not_regular_ride")
    );
  }

  const pickup = parseUsableCoordinatePair(booking?.pickup_lat, booking?.pickup_lng);
  const dropoff = parseUsableCoordinatePair(booking?.dropoff_lat, booking?.dropoff_lng);
  if (!pickup || !dropoff) {
    return fallbackEvaluation(
      "trip_coordinates_unavailable",
      null,
      notAttemptedElevation("trip_coordinates_unavailable")
    );
  }

  const from: RoadPoint = { lat: pickup.lat, lng: pickup.lng };
  const to: RoadPoint = { lat: dropoff.lat, lng: dropoff.lng };
  const roadTrip = await getDrivingRoadRouteWithGeometry(from, to, { overview: "full" });
  if (!roadTrip) {
    return fallbackEvaluation(
      "trip_road_route_unavailable",
      null,
      notAttemptedElevation("trip_road_route_unavailable")
    );
  }

  if (roadTrip.distanceKm > SHORT_TRIP_MAX_ROAD_DISTANCE_KM) {
    return fallbackEvaluation(
      "road_distance_above_short_trip_limit",
      roadTrip.distanceKm,
      notAttemptedElevation("road_distance_above_short_trip_limit")
    );
  }

  if (!roadTrip.geometry) {
    return fallbackEvaluation(
      "trip_road_route_geometry_unavailable",
      roadTrip.distanceKm,
      notAttemptedElevation("trip_road_route_geometry_unavailable")
    );
  }

  const elevation = await getValidatedCumulativePositiveElevationGain(
    roadTrip.geometry,
    roadTrip.distanceKm
  );
  if (
    elevation.status !== "validated" ||
    elevation.cumulativePositiveElevationGainM == null
  ) {
    return fallbackEvaluation(
      elevation.status === "invalid"
        ? "elevation_invalid"
        : "elevation_unavailable",
      roadTrip.distanceKm,
      elevation
    );
  }

  const driverLocationRes = await supabase
    .from("driver_locations_latest")
    .select("lat,lng")
    .eq("driver_id", driverId)
    .maybeSingle();
  const driverLocation = parseUsableCoordinatePair(
    driverLocationRes?.data?.lat,
    driverLocationRes?.data?.lng
  );
  if (!driverLocation) {
    return fallbackEvaluation(
      "driver_location_unavailable_for_pickup_fee",
      roadTrip.distanceKm,
      elevation
    );
  }

  const pickupRoad = await getDrivingRoadRoute(
    { lat: driverLocation.lat, lng: driverLocation.lng },
    from
  );
  if (!pickupRoad) {
    return fallbackEvaluation(
      "pickup_road_route_unavailable",
      roadTrip.distanceKm,
      elevation
    );
  }

  if (!isNormalRidePickupDistance(pickupRoad.distanceKm)) {
    return fallbackEvaluation(
      pickupRoad.distanceKm > RIDE_PICKUP_NORMAL_MAX_KM
        ? "pickup_distance_exceeds_normal_limit"
        : "pickup_distance_invalid",
      roadTrip.distanceKm,
      elevation,
      pickupRoad.distanceKm,
      pickupRoad.durationSeconds == null
        ? estimateEtaMinutes(pickupRoad.distanceKm)
        : Math.max(1, Math.ceil(pickupRoad.durationSeconds / 60))
    );
  }

  const pickupDistanceFee = computeRidePickupFee(pickupRoad.distanceKm);
  const fare = computeShortTripAutomaticFare({
    roadDistanceKm: roadTrip.distanceKm,
    validatedCumulativePositiveElevationGainM:
      elevation.cumulativePositiveElevationGainM,
    pickupDistanceFee,
  });
  const base: Omit<ShortTripFareEvaluation, "snapshot"> = {
    outcome: "automatic",
    fallbackReason: null,
    roadDistanceKm: roadTrip.distanceKm,
    driverToPickupKm: pickupRoad.distanceKm,
    pickupEtaMinutes:
      pickupRoad.durationSeconds == null
        ? estimateEtaMinutes(pickupRoad.distanceKm)
        : Math.max(1, Math.ceil(pickupRoad.durationSeconds / 60)),
    pickupDistanceFee,
    elevation,
    fare,
  };
  return { ...base, snapshot: makeSnapshot(base, null) };
}

