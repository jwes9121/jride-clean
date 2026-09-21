export function weightConfirmationError(basis: string, weight: string, band: string): string | null {
  if (basis === "exact") {
    const kg = Number(weight);
    if (!Number.isFinite(kg) || kg <= 0) return "Enter the measured total weight in kg to continue. Use Exact only if the cargo was weighed.";
    if (kg > 200) return "Cargo above 200 kg is not supported. Correct the weight or choose Cannot fulfill.";
    return null;
  }
  if (band === "over_200") return "Cargo above 200 kg is not supported. Correct the range or choose Cannot fulfill.";
  if (!["1_15", "16_25", "26_50", "51_100", "101_200"].includes(band)) {
    return "Select a weight range to continue. The kg estimate does not replace the required weight range.";
  }
  if (weight.trim() && (!Number.isFinite(Number(weight)) || Number(weight) <= 0 || Number(weight) > 200)) {
    return "Enter an estimate greater than 0 and no more than 200 kg, or leave the optional estimate blank.";
  }
  return null;
}
