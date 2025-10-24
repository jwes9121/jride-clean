// TEMP STUB FOR BUILD
// TODO: replace with real fare calculation logic

export type FareBreakdown = {
  baseFare: number;
  distanceKm: number;
  perKm: number;
  total: number;
  currency: string;
};

export function estimateFare(
  pickupTown: string,
  dropoffTown: string,
  distanceKm: number
): FareBreakdown {
  // dumb placeholder math:
  // base ₱20 + ₱10/km
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

// Some code may expect this name:
export function formatFare(breakdown: FareBreakdown): string {
  return `₱${breakdown.total.toFixed(2)} (${breakdown.distanceKm.toFixed(
    2
  )} km est.)`;
}
