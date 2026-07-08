// lib/advance-booking/pricing.ts
//
// Pure fare computation for JRide Advance Booking.
// No database access. No side effects. 100% testable.
//
// Fare rules:
//   1. Trip distance -> ride fare via LGU matrix
//   2. Scheduled pickup time -> fare bracket -> night premium
//   3. Departure distance -> pickup fee (free if <= FREE_PICKUP_KM)
//   4. Flat platform fee

import {
  FARE_MATRIX,
  FREE_PICKUP_KM,
  PICKUP_FEE_RATE_PER_KM,
  PLATFORM_FEE_NORMAL,
  PLATFORM_FEE_STANDARD,
  LATE_NIGHT_BASE_FARE,
  DOUBLE_FARE_START_HOUR_PHT,
  DOUBLE_FARE_END_HOUR_PHT,
  LATE_NIGHT_START_HOUR_PHT,
  DAYTIME_START_HOUR_PHT,
  DAYTIME_END_HOUR_PHT,
} from "./constants";

import type { BookingMode, FareBracket, PricingInput, PricingResult } from "./types";

// PHT offset from UTC in milliseconds
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Get the hour of day in Philippine Time (PHT = UTC+8).
 */
function phtHour(date: Date): number {
  const phtMs = date.getTime() + PHT_OFFSET_MS;
  const phtDate = new Date(phtMs);
  return phtDate.getUTCHours();
}

/**
 * Determine booking mode and fare bracket from scheduled pickup time.
 *
 * Mode:
 *   daytime = 05:00-19:59 PHT
 *   night   = 20:00-04:59 PHT
 *
 * Fare bracket:
 *   normal     = 05:00-19:59 PHT  (standard matrix)
 *   double     = 20:00-22:59 PHT  (standard matrix x 2)
 *   late_night = 23:00-04:59 PHT  (base P100 + standard matrix)
 */
export function determineModeAndBracket(scheduledPickupAt: Date): {
  bookingMode: BookingMode;
  fareBracket: FareBracket;
} {
  const hour = phtHour(scheduledPickupAt);

  // Normal: 05:00-19:59
  if (hour >= DAYTIME_START_HOUR_PHT && hour <= DAYTIME_END_HOUR_PHT) {
    return { bookingMode: "daytime", fareBracket: "normal" };
  }

  // Double: 20:00-22:59
  if (hour >= DOUBLE_FARE_START_HOUR_PHT && hour <= DOUBLE_FARE_END_HOUR_PHT) {
    return { bookingMode: "night", fareBracket: "double" };
  }

  // Late night: 23:00-04:59
  // Covers hour >= 23 OR hour < DAYTIME_START_HOUR_PHT (i.e. 0,1,2,3,4)
  return { bookingMode: "night", fareBracket: "late_night" };
}

/**
 * Compute ride fare from trip distance using LGU fare matrix.
 * Does NOT include night premium. Call computeNightPremium separately.
 */
export function computeRideFare(tripDistanceKm: number): number {
  if (tripDistanceKm <= 0) return FARE_MATRIX.minimumFare;

  const distanceFare =
    FARE_MATRIX.baseFare +
    Math.max(0, tripDistanceKm - 1) * FARE_MATRIX.perKmRate;

  return Math.max(FARE_MATRIX.minimumFare, Math.round(distanceFare));
}

/**
 * Compute night premium based on fare bracket.
 * Returns the additional amount to add to the base ride fare.
 */
export function computeNightPremium(
  baseFare: number,
  fareBracket: FareBracket
): number {
  switch (fareBracket) {
    case "normal":
      return 0;

    case "double":
      // Double fare: rider pays 2x, driver earns the premium
      return baseFare; // total = baseFare + baseFare = baseFare * 2

    case "late_night":
      // Base P100 added on top of matrix fare
      return LATE_NIGHT_BASE_FARE;

    default:
      return 0;
  }
}

/**
 * Compute pickup fee.
 * Free if driver departure is within FREE_PICKUP_KM of the pickup point.
 * Otherwise: (distance - FREE_PICKUP_KM) * PICKUP_FEE_RATE_PER_KM, rounded up.
 */
export function computePickupFee(pickupDistanceKm: number): number {
  if (pickupDistanceKm <= FREE_PICKUP_KM) return 0;

  const chargeableKm = pickupDistanceKm - FREE_PICKUP_KM;
  return Math.ceil(chargeableKm * PICKUP_FEE_RATE_PER_KM);
}

/**
 * Compute platform fee based on ride fare.
 */
export function computePlatformFee(rideFare: number): number {
  return rideFare < 50 ? PLATFORM_FEE_NORMAL : PLATFORM_FEE_STANDARD;
}

/**
 * Full pricing computation.
 * Input: trip distance, departure distance, scheduled time.
 * Output: complete PricingResult with all fare components.
 *
 * This is the single entry point for all fare computations.
 * Used by offer.ts when a driver selects their departure location.
 */
export function computeFare(input: PricingInput): PricingResult {
  const { tripDistanceKm, pickupDistanceKm, scheduledPickupAt } = input;

  const { bookingMode, fareBracket } = determineModeAndBracket(scheduledPickupAt);

  const rideFare = computeRideFare(tripDistanceKm);
  const nightPremium = computeNightPremium(rideFare, fareBracket);
  const pickupFee = computePickupFee(pickupDistanceKm);
  const platformFee = computePlatformFee(rideFare);

  const total = rideFare + nightPremium + pickupFee + platformFee;

  return {
    rideFare,
    nightPremium,
    pickupFee,
    platformFee,
    total,
    bookingMode,
    fareBracket,
    pickupDistanceKm,
    pickupIsFree: pickupDistanceKm <= FREE_PICKUP_KM,
    nightRateApplied: fareBracket !== "normal",
  };
}

/**
 * Estimate fare using a reference pickup distance.
 * Used when creating the booking before any driver has been matched.
 * Pass pickupDistanceKm = 0 to show the best-case (free pickup) estimate.
 */
export function estimateFare(
  tripDistanceKm: number,
  scheduledPickupAt: Date,
  referencePickupKm = 0
): PricingResult {
  return computeFare({
    tripDistanceKm,
    pickupDistanceKm: referencePickupKm,
    scheduledPickupAt,
  });
}
