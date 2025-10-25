<<<<<<< HEAD
// TEMP STUB FOR BUILD
// TODO: replace with real fare logic

export type FareBreakdown = {
=======
﻿export type FareBreakdown = {
>>>>>>> fix/auth-v5-clean
  baseFare: number;
  distanceKm: number;
  perKm: number;
  total: number;
  currency: string;
};

<<<<<<< HEAD
// Generic estimator for demo
=======
// Simple placeholder calculator
>>>>>>> fix/auth-v5-clean
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
<<<<<<< HEAD
    distanceKm,
    perKm,
    total,
=======
    distanceKm: distanceKm,
    perKm: perKm,
    total: total,
>>>>>>> fix/auth-v5-clean
    currency: "PHP",
  };
}

<<<<<<< HEAD
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
=======
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
>>>>>>> fix/auth-v5-clean
export function computeTriplycFare(
  origin: string,
  destination: string,
  passengers: number
): { total: number; perHead: number; currency: string } {
<<<<<<< HEAD
  // placeholder math
=======
  // very dumb placeholder math
>>>>>>> fix/auth-v5-clean
  const base = 50;
  const perHead = 25 * passengers;
  const total = base + perHead;

  return {
<<<<<<< HEAD
    total,
    perHead,
=======
    total: total,
    perHead: perHead,
>>>>>>> fix/auth-v5-clean
    currency: "PHP",
  };
}
