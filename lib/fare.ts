// lib/fare.ts

/**
 * computeTriplycFare
 *
 * Unified fare calculation for tricycle rides.
 *
 * Inputs:
 *  - origin: pickup location (string, ex. "Lagawe Public Market")
 *  - destination: dropoff location (string, ex. "Kiangan Plaza")
 *  - passengers: number of passengers (1+)
 *
 * Current rules:
 *  - Base flagdown fare: ₱20
 *  - Each extra passenger after the first: +₱10 per head
 *
 * Later we can add distance logic, LGU zoning, nighttime surcharge, etc.
 */
export function computeTriplycFare(
  origin: string,
  destination: string,
  passengers: number
): number {
  // base starting fare
  const baseFare = 20;

  // charge ₱10 per extra passenger after 1
  const extras = passengers > 1 ? (passengers - 1) * 10 : 0;

  // You can later adjust by origin/destination (e.g. crossing towns, uphill roads, etc.)
  // For now, origin and destination are unused but kept in signature for future pricing rules.
  return baseFare + extras;
}
