export const SHORT_TRIP_AUTOMATIC_FARE_VERSION = "short_trip_automatic_v1";
// The lifecycle/formula version stays compatible with existing bookings.
// Each new evaluation also records this monetary rounding policy.
export const SHORT_TRIP_FARE_ROUNDING_VERSION = "ride_fare_nearest_peso_half_up_v1";
export const SHORT_TRIP_AUTOMATIC_PASSENGER_HEADING = "Short Trip - Automatic Fare";
export const SHORT_TRIP_AUTOMATIC_PASSENGER_BODY =
  "This trip is within 3 km. Once a driver accepts, your trip proceeds automatically. No need to wait for a Proposed Fare.";
export const SHORT_TRIP_AUTOMATIC_DRIVER_HEADING = "Short Trip - Automatic Fare";
export const SHORT_TRIP_AUTOMATIC_DRIVER_BODY =
  "This trip is within 3 km. Once you accept, proceed to the passenger pickup location. No Proposed Fare is needed.";

export const SHORT_TRIP_MAX_ROAD_DISTANCE_KM = 3;
export const SHORT_TRIP_MIN_RIDE_FARE = 25;
export const SHORT_TRIP_DISTANCE_RATE = 20;
export const SHORT_TRIP_FREE_ELEVATION_ALLOWANCE_M = 25;
export const SHORT_TRIP_ELEVATION_RATE_PER_M = 0.1;
export const SHORT_TRIP_CONVENIENCE_FEE = 15;
export const SHORT_TRIP_MIN_PASSENGER_TOTAL = 40;

export type ShortTripFareInput = {
  roadDistanceKm: number;
  validatedCumulativePositiveElevationGainM: number;
  pickupDistanceFee?: number;
};

export type ShortTripFareResult = {
  roadDistanceKm: number;
  validatedCumulativePositiveElevationGainM: number;
  freeElevationAllowanceM: number;
  chargeableElevationGainM: number;
  distanceComponent: number;
  elevationPremium: number;
  rideFareBeforeMinimum: number;
  automaticRideFare: number;
  rideFareBeforeRounding: number;
  rideFareRoundingAdjustment: number;
  roundingVersion: string;
  rideMinimumApplied: boolean;
  convenienceFee: number;
  pickupDistanceFee: number;
  passengerTotalBeforeMinimum: number;
  total: number;
  passengerTotalMinimumApplied: boolean;
  minimumApplied: boolean;
};

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function requireFiniteNonNegative(value: number, code: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(code);
  }
  return value;
}

export function computeShortTripAutomaticFare(
  input: ShortTripFareInput
): ShortTripFareResult {
  const roadDistanceKm = requireFiniteNonNegative(
    input.roadDistanceKm,
    "INVALID_SHORT_TRIP_ROAD_DISTANCE"
  );
  const elevationGainM = requireFiniteNonNegative(
    input.validatedCumulativePositiveElevationGainM,
    "INVALID_SHORT_TRIP_ELEVATION_GAIN"
  );
  const pickupDistanceFee = requireFiniteNonNegative(
    input.pickupDistanceFee ?? 0,
    "INVALID_SHORT_TRIP_PICKUP_FEE"
  );

  if (roadDistanceKm > SHORT_TRIP_MAX_ROAD_DISTANCE_KM) {
    throw new RangeError("SHORT_TRIP_ROAD_DISTANCE_EXCEEDS_LIMIT");
  }

  const freeElevationAllowanceM = SHORT_TRIP_FREE_ELEVATION_ALLOWANCE_M;
  const chargeableElevationGainM = Math.max(
    0,
    elevationGainM - freeElevationAllowanceM
  );
  const distanceComponent = roadDistanceKm * SHORT_TRIP_DISTANCE_RATE;
  const elevationPremium =
    chargeableElevationGainM * SHORT_TRIP_ELEVATION_RATE_PER_M;
  const rideFareBeforeMinimum = roundMoney(
    distanceComponent + elevationPremium
  );
  const rawRideFare = distanceComponent + elevationPremium;
  const rideFareBeforeRounding = Math.max(SHORT_TRIP_MIN_RIDE_FARE, rawRideFare);
  // Round once, after the minimum. Do not first round to cents: 29.499 must
  // remain 29, and the road-distance eligibility boundary stays unrounded.
  const automaticRideFare = Math.round(rideFareBeforeRounding);
  const passengerTotalBeforeMinimum = roundMoney(
    automaticRideFare + pickupDistanceFee + SHORT_TRIP_CONVENIENCE_FEE
  );
  const total = roundMoney(
    Math.max(SHORT_TRIP_MIN_PASSENGER_TOTAL, passengerTotalBeforeMinimum)
  );

  return {
    roadDistanceKm,
    validatedCumulativePositiveElevationGainM: elevationGainM,
    freeElevationAllowanceM,
    chargeableElevationGainM,
    distanceComponent: roundMoney(distanceComponent),
    elevationPremium: roundMoney(elevationPremium),
    rideFareBeforeMinimum,
    automaticRideFare,
    rideFareBeforeRounding: Number(rideFareBeforeRounding.toFixed(6)),
    rideFareRoundingAdjustment: Number((automaticRideFare - rideFareBeforeRounding).toFixed(6)),
    roundingVersion: SHORT_TRIP_FARE_ROUNDING_VERSION,
    rideMinimumApplied: rawRideFare < SHORT_TRIP_MIN_RIDE_FARE,
    convenienceFee: SHORT_TRIP_CONVENIENCE_FEE,
    pickupDistanceFee: roundMoney(pickupDistanceFee),
    passengerTotalBeforeMinimum,
    total,
    passengerTotalMinimumApplied: total > passengerTotalBeforeMinimum,
    minimumApplied:
      rawRideFare < SHORT_TRIP_MIN_RIDE_FARE ||
      total > passengerTotalBeforeMinimum,
  };
}

export function isRegularRideServiceType(value: unknown): boolean {
  const serviceType = String(value ?? "").trim().toLowerCase();
  return serviceType === "motorcycle" || serviceType === "tricycle";
}
