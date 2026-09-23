// Monetary line totals use decimal integers and half-up rounding, matching PostgreSQL numeric.
export function scaledDecimal(value: unknown, scale: number): bigint {
  const text = String(value ?? "").trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[2] || "").length > scale) throw new Error("Invalid decimal precision");
  const result = BigInt(match[1]) * BigInt(10) ** BigInt(scale) + BigInt((match[2] || "").padEnd(scale, "0") || "0");
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount too large");
  return result;
}
export function lineCents(price: unknown, quantity: unknown): bigint {
  const cents = scaledDecimal(price, 2), thousandths = scaledDecimal(quantity, 3);
  const result = (cents * thousandths + BigInt(500)) / BigInt(1000);
  if (result > BigInt(999999999999)) throw new Error("Amount too large");
  return result;
}
export function moneyFromCents(cents: bigint): number {
  if (cents < BigInt(0) || cents > BigInt(999999999999)) throw new Error("Amount too large");
  return Number(cents) / 100;
}
