export type FareBreakdown = {
  base: number;
  distance: number;
  time: number;
  total: number;
};

// Basic fare calculator used by rider estimate flow
export function estimateFare(params: {
  distanceKm: number;
  minutes: number;
}): FareBreakdown {
  const base = 50;
  const perKm = 15;
  const perMin = 2;

  const distance = params.distanceKm * perKm;
  const time = params.minutes * perMin;
  const total = base + distance + time;

  return {
    base,
    distance,
    time,
    total,
  };
}

// Turns a FareBreakdown into a peso string
export function formatFare(breakdown: FareBreakdown): string {
  return `₱${breakdown.total.toFixed(2)}`;
}

// === STUBS NEEDED BY OTHER PAGES / API ROUTES =======================

// This is what driver/post-trip and confirm-fare screens call
// We just return a "total" number so the UI can render something.
export function computeTriplycFare(opts: {
  mode?: string;        // "tricycle" | "motorcycle" | etc.
  passengers?: number;
  distanceKm?: number;
  minutes?: number;
}): FareBreakdown {
  const distanceKm = opts.distanceKm ?? 2;
  const minutes = opts.minutes ?? 5;

  // reuse estimateFare logic under the hood
  const est = estimateFare({ distanceKm, minutes });

  // If they care about mode/passengers for surcharge later,
  // you could tweak est.total here. For now we leave it alone.

  return est;
}

// Platform deduction (what % the platform keeps)
// DriverPostTripClient.tsx imports this.
export function platformDeduction(totalPeso: number): number {
  // Example: 20% platform fee
  const feeRate = 0.2;
  const fee = totalPeso * feeRate;
  // driver keeps the rest
  return totalPeso - fee;
}

// ====================================================================

// default export in case legacy code does `import fare from "@/lib/fare"`
const fareApi = {
  estimateFare,
  formatFare,
  computeTriplycFare,
  platformDeduction,
};

export default fareApi;