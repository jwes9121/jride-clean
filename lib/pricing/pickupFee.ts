// lib/pricing/pickupFee.ts
//
// Shared pickup-distance pricing for JRide ride services.
// The distance input must be DRIVING ROAD distance, not radius/Haversine.
//
// Business rule:
// - First 1.5 km: free.
// - Over 1.5 km through 6.5 km: PHP20 per started 0.5 km block.
// - Over 6.5 km through 10 km: PHP10 per started 0.5 km block.
// - More than 10 km is outside normal-assignment pricing.

export const RIDE_PICKUP_FREE_KM = 1.5;
export const RIDE_PICKUP_TIER_ONE_END_KM = 6.5;
export const RIDE_PICKUP_NORMAL_MAX_KM = 10;
export const RIDE_PICKUP_BLOCK_KM = 0.5;
export const RIDE_PICKUP_TIER_ONE_FEE_PER_BLOCK = 20;
export const RIDE_PICKUP_TIER_TWO_FEE_PER_BLOCK = 10;
export const RIDE_PICKUP_TIER_ONE_MAX_FEE = 200;
export const RIDE_PICKUP_NORMAL_MAX_FEE = 270;

export function isNormalRidePickupDistance(distanceKm: number): boolean {
  return Number.isFinite(distanceKm) &&
    distanceKm >= 0 &&
    distanceKm <= RIDE_PICKUP_NORMAL_MAX_KM;
}

export function computeRidePickupFee(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new RangeError("INVALID_PICKUP_DISTANCE");
  }

  if (distanceKm > RIDE_PICKUP_NORMAL_MAX_KM) {
    throw new RangeError("PICKUP_DISTANCE_EXCEEDS_NORMAL_LIMIT");
  }

  if (distanceKm <= RIDE_PICKUP_FREE_KM) {
    return 0;
  }

  const tierOneChargeableKm =
    Math.min(distanceKm, RIDE_PICKUP_TIER_ONE_END_KM) - RIDE_PICKUP_FREE_KM;
  const tierOneBlocks = Math.ceil(tierOneChargeableKm / RIDE_PICKUP_BLOCK_KM);
  const tierOneFee = tierOneBlocks * RIDE_PICKUP_TIER_ONE_FEE_PER_BLOCK;

  if (distanceKm <= RIDE_PICKUP_TIER_ONE_END_KM) {
    return tierOneFee;
  }

  const tierTwoChargeableKm = distanceKm - RIDE_PICKUP_TIER_ONE_END_KM;
  const tierTwoBlocks = Math.ceil(tierTwoChargeableKm / RIDE_PICKUP_BLOCK_KM);
  const tierTwoFee = tierTwoBlocks * RIDE_PICKUP_TIER_TWO_FEE_PER_BLOCK;

  return tierOneFee + tierTwoFee;
}
