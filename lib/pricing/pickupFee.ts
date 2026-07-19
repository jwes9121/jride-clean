// lib/pricing/pickupFee.ts
//
// Shared pickup-distance pricing for JRide ride services.
//
// Business rule:
// - First 1.5 km from driver departure point to passenger pickup is free.
// - Beyond 1.5 km, charge PHP20 per started 0.5 km block.
//
// This is intentionally identical to the current production Ride formula.

export const RIDE_PICKUP_FREE_KM = 1.5;
export const RIDE_PICKUP_BLOCK_KM = 0.5;
export const RIDE_PICKUP_FEE_PER_BLOCK = 20;

export function computeRidePickupFee(distanceKm: number): number {
  const chargeableKm = Math.max(0, distanceKm - RIDE_PICKUP_FREE_KM);

  if (chargeableKm <= 0) {
    return 0;
  }

  const blocks = Math.ceil(chargeableKm / RIDE_PICKUP_BLOCK_KM);
  return blocks * RIDE_PICKUP_FEE_PER_BLOCK;
}