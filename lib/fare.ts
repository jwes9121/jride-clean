// lib/fare.ts

export type FareBreakdown = {
  total: number;
  perHead: number;
  currency: string;
};

/**
 * Unified fare calculator for a tricycle ("tricy") ride.
 *
 * Inputs:
 *  - origin: string
 *  - destination: string
 *  - passengers: number
 *
 * Pricing model (simple stub for now):
 *  - Base fare = ₱20
 *  - Each extra passenger after the first adds ₱10
 *
 * Output:
 *  {
 *    total: number,       // total fare in pesos
 *    perHead: number,     // split per passenger, rounded
 *    currency: "PHP"
 *  }
 */
export function computeTriplycFare(
  origin: string,
  destination: string,
  passengers: number
): FareBreakdown {
  // base fare
  const base = 20;

  // extra passengers beyond first: +10 each
  const extras = passengers > 1 ? (passengers - 1) * 10 : 0;

  const total = base + extras;

  // avoid division by zero
  const perHead =
    passengers > 0 ? Math.ceil(total / passengers) : total;

  return {
    total,
    perHead,
    currency: "PHP",
  };
}
