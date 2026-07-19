// scripts/verify-pickup-fee-parity.ts

import { computeRidePickupFee } from "../lib/pricing/pickupFee";

function currentProductionRidePickupFee(distanceKm: number): number {
  const freeKm = 1.5;
  const blockKm = 0.5;
  const feePerBlock = 20;

  const chargeableKm = Math.max(0, distanceKm - freeKm);

  if (chargeableKm <= 0) {
    return 0;
  }

  const blocks = Math.ceil(chargeableKm / blockKm);
  return blocks * feePerBlock;
}

type Comparison = {
  distanceKm: number;
  productionRideFee: number;
  sharedHelperFee: number;
  matches: boolean;
};

const distances = new Set<number>();

// Every 250 meters from 0 km through 20 km.
for (let quarterKm = 0; quarterKm <= 80; quarterKm += 1) {
  distances.add(quarterKm / 4);
}

// Explicit boundary and real production examples.
[
  0,
  0.01,
  1.49,
  1.5,
  1.500001,
  1.99,
  2,
  2.000001,
  2.37,
  2.49,
  2.5,
  2.500001,
  3.03,
  8.39,
  10,
  10.5,
  19.999999,
  20,
].forEach((distanceKm) => distances.add(distanceKm));

const comparisons: Comparison[] = [...distances]
  .sort((a, b) => a - b)
  .map((distanceKm) => {
    const productionRideFee =
      currentProductionRidePickupFee(distanceKm);

    const sharedHelperFee =
      computeRidePickupFee(distanceKm);

    return {
      distanceKm,
      productionRideFee,
      sharedHelperFee,
      matches: productionRideFee === sharedHelperFee,
    };
  });

const mismatches = comparisons.filter((row) => !row.matches);

console.table(comparisons);

console.log("");
console.log(`Cases checked: ${comparisons.length}`);
console.log(`Matches: ${comparisons.length - mismatches.length}`);
console.log(`Mismatches: ${mismatches.length}`);

if (mismatches.length > 0) {
  console.error("");
  console.error("PARITY CHECK FAILED");
  console.table(mismatches);
  process.exitCode = 1;
} else {
  console.log("");
  console.log("PARITY CHECK PASSED: shared helper exactly matches current Ride.");
}