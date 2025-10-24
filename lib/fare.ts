// TEMP STUB FOR BUILD
// TODO: replace with real fare logic

export type FareBreakdown = {
  baseFare: number;
  distanceKm: number;
  perKm: number;
  total: number;
  currency: string;
};

// Generic estimator for demo
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
    distanceKm,
    perKm,
    total,
    currency: "PHP",
  };
}

export function formatFare(breakdown: FareBreakdown): string {
  return `₱${breakdown.total.toFixed(2)} (${breakdown.distanceKm.toFixed(
    2
  )} km est.)`;
}

// ----------------------
// EXTRA EXPORTS FOR BUILD
// ----------------------

// Your DriverPostTripClient.tsx imports platformDeduction(total)
// We'll just return 0 for now so build passes.
export function platformDeduction(total: number): number {
  // placeholder logic: platform takes 0 for now
  return 0;
}

// Your ConfirmFareClient.tsx imports computeTriplycFare(params?)
// We just return a fake object that looks like a "fare" response.
export function computeTriplycFare(
  origin: string,
  destination: string,
  passengers: number
): { total: number; perHead: number; currency: string } {
  // placeholder math
  const base = 50;
  const perHead = 25 * passengers;
  const total = base + perHead;

  return {
    total,
    perHead,
    currency: "PHP",
  };
}
