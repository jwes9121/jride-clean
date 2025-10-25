export type FareBreakdown = {
  baseFare: number;
  distanceKm: number;
  perKm: number;
  total: number;
  currency: string;
};

// Simple placeholder calculator
export function estimateFare(
  pickupTown: string,
  dropoffTown: string,
  distanceKm: number
): FareBreakdown {
  const base = 20;
  const perKm = 10;
  const total = base + perKm * distanceKm;

  return {
    baseFare: base,
    distanceKm: distanceKm,
    perKm: perKm,
    total: total,
    currency: "PHP",
  };
}

// Format a readable string for UI
export function formatFare(breakdown: FareBreakdown): string {
  return (
    breakdown.total.toFixed(2) +
    " " +
    breakdown.currency +
    " (" +
    breakdown.distanceKm.toFixed(2) +
    " km est.)"
  );
}

// ===== extra exports so existing components compile =====

// used by DriverPostTripClient.tsx
export function platformDeduction(total: number): number {
  // placeholder: platform takes 0
  return 0;
}

// used by ConfirmFareClient.tsx
export function computeTriplycFare(
  origin: string,
  destination: string,
  passengers: number
): { total: number; perHead: number; currency: string } {
  // very dumb placeholder math
  const base = 50;
  const perHead = 25 * passengers;
  const total = base + perHead;

  return {
    total: total,
    perHead: perHead,
    currency: "PHP",
  };
}
