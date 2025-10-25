// lib/computeTriplycFare.ts

/**
 * Rough fare computation for tricycle booking.
 *
 * We accept:
 * - origin: string (pickup area / barangay / town)
 * - destination: string (dropoff)
 * - passengers: number (1+)
 *
 * You can improve this later with distance-based logic, town pricing, etc.
 * For now we just:
 *   baseFare = 20 pesos
 *   perExtraPassenger = +10 pesos per passenger after 1
 *   NOTE: you can plug distance/zone later.
 */
export function computeTriplycFare(
  origin: string,
  destination: string,
  passengers: number
): number {
  // base tricycle flagdown
  const baseFare = 20;

  // each extra passenger after the first adds +10
  const extras =
    passengers > 1 ? (passengers - 1) * 10 : 0;

  // TODO: you can later apply zone-based multiplier depending on origin->destination
  // For now we ignore origin/destination and just return base + extras.
  return baseFare + extras;
}
