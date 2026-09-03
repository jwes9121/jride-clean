export type UsableCoordinatePair = {
  lat: number;
  lng: number;
};

export function parseFiniteCoordinate(value: unknown): number | null {
  if (typeof value === "boolean" || value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }

  if (typeof value === "string" && !value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseUsableCoordinatePair(
  latitude: unknown,
  longitude: unknown
): UsableCoordinatePair | null {
  const lat = parseFiniteCoordinate(latitude);
  const lng = parseFiniteCoordinate(longitude);

  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  // JRide stores 0/0 as the temporary "GPS not ready" sentinel.
  // A zero on only one axis remains a legitimate global coordinate.
  if (lat === 0 && lng === 0) return null;

  return { lat, lng };
}

export function hasUsableLocationCoordinates(
  latitude: unknown,
  longitude: unknown
): boolean {
  return parseUsableCoordinatePair(latitude, longitude) !== null;
}
