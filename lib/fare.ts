export type FareBreakdown = {
  base: number;
  addPassengers: number;
  convenienceFee: number;
  total: number;
};

export function computeTricycleFare(passengers: number): FareBreakdown {
  const p = Math.max(1, Math.min(4, Math.floor(passengers || 1)));
  const base = 30;                    // LLGU matrix
  const addPassengers = p > 1 ? (p - 1) * 20 : 0;
  const convenienceFee = 15;
  const total = base + addPassengers + convenienceFee;
  return { base, addPassengers, convenienceFee, total };
}

export function platformDeduction(total: number): number {
  return total >= 50 ? 20 : 0; // â‚±15 service + â‚±5 LGU/system share
}


