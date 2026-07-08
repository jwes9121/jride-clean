// lib/advance-booking/distance.ts
//
// Pure distance calculation functions.
// No database access. No side effects. 100% testable.

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Haversine formula.
 * Returns great-circle distance in kilometers between two coordinates.
 * Accurate to within ~0.5% for the distances involved in JRide operations.
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

/**
 * Round distance to 2 decimal places.
 * Used for consistent storage in NUMERIC(8,2) columns.
 */
export function roundKm(km: number): number {
  return Math.round(km * 100) / 100;
}

/**
 * Returns distance in km between departure and pickup point.
 * This is the distance used to compute the pickup fee.
 */
export function pickupDistanceKm(
  departureLat: number,
  departureLng: number,
  pickupLat: number,
  pickupLng: number
): number {
  return roundKm(haversineKm(departureLat, departureLng, pickupLat, pickupLng));
}

/**
 * Returns trip distance in km from pickup to destination.
 * This is the distance used to compute the ride fare.
 */
export function tripDistanceKm(
  pickupLat: number,
  pickupLng: number,
  destinationLat: number,
  destinationLng: number
): number {
  return roundKm(
    haversineKm(pickupLat, pickupLng, destinationLat, destinationLng)
  );
}
