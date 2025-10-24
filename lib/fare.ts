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
  // placeholder logic
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
