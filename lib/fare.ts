export type FareBreakdown = {
  base: number;
  distance: number;
  time: number;
  total: number;
};

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

export function formatFare(breakdown: FareBreakdown): string {
  return `₱${breakdown.total.toFixed(2)}`;
}

// Keep a default export in case something imports default from "lib/fare"
const fareApi = {
  estimateFare,
  formatFare,
};
export default fareApi;