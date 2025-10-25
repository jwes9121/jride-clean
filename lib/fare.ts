export type FareBreakdown = {
  base: number;
  distance: number;
  time: number;
  total: number;
};

// For rider estimate / preview UI
export function estimateFare(params: {
  distanceKm: number;
  minutes: number;
}): FareBreakdown {
  const base = 50;
  const perKm = 15;
  const perMin = 2;

  const distance = (params.distanceKm ?? 0) * perKm;
  const time = (params.minutes ?? 0) * perMin;
  const total = base + distance + time;

  return {
    base,
    distance,
    time,
    total,
  };
}

// For driver trip confirmation / API booking, app code expects this name EXACTLY
export function computeTriplycFare(opts: {
  mode?: string;          // "tricycle" | "motorcycle" | etc.
  passengers?: number;
  distanceKm?: number;
  minutes?: number;
}): FareBreakdown {
  // crude fallback math that won't crash
  const distanceKm = opts.distanceKm ?? 2;
  const minutes = opts.minutes ?? 5;

  return estimateFare({ distanceKm, minutes });
}

// For driver post-trip payout screen, app code expects this name EXACTLY
// Input: totalPeso (the full fare from computeTriplycFare().total)
// Output: driver's share after platform fee
export function platformDeduction(totalPeso: number): number {
  const feeRate = 0.2; // 20% platform fee
  const driverShare = totalPeso - totalPeso * feeRate;
  return driverShare;
}

// Format helper for display
export function formatFare(breakdown: FareBreakdown): string {
  return `₱${breakdown.total.toFixed(2)}`;
}

// Default export for any legacy `import fare from "@/lib/fare"`
const fareApi = {
  estimateFare,
  computeTriplycFare,
  platformDeduction,
  formatFare,
};
export default fareApi;