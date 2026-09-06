// Reject missing/non-numeric values before conversion: Number(null) is zero.
export function coordinate(value: unknown, limit: 90 | 180): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

export function hasValidPin(lat: unknown, lng: unknown): boolean {
  return coordinate(lat, 90) !== null && coordinate(lng, 180) !== null;
}
