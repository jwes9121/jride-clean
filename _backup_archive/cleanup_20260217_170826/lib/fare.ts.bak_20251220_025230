// lib/fare.ts

export type FareBreakdown = {
  total: number;
  perHead: number;
  currency: string;
};

/**
 * computeTriplycFare
 *
 * Simple pricing model:
 * - base fare â‚±20
 * - each passenger after the first adds â‚±10
 *
 * returns object with total, perHead, currency
 */
export function computeTriplycFare(
  origin: string,
  destination: string,
  passengers: number
): FareBreakdown {
  const base = 20;
  const extras = passengers > 1 ? (passengers - 1) * 10 : 0;
  const total = base + extras;
  const perHead =
    passengers > 0 ? Math.ceil(total / passengers) : total;

  return {
    total,
    perHead,
    currency: "PHP",
  };
}

/**
 * platformDeduction
 *
 * Given a fare amount in pesos, return how much the platform
 * takes as its cut (and/or net to driver).
 *
 * We'll assume:
 * - Platform keeps 20%
 * - Driver receives 80%
 *
 * You can change the % later. This just unblocks build.
 */
export function platformDeduction(amount: number): {
  gross: number;   // original fare
  platformCut: number; // what the app/company keeps
  driverTakeHome: number; // what driver keeps
  rate: number; // platform % as decimal
} {
  const rate = 0.2; // 20% platform
  const platformCut = Math.round(amount * rate);
  const driverTakeHome = amount - platformCut;

  return {
    gross: amount,
    platformCut,
    driverTakeHome,
    rate,
  };
}
