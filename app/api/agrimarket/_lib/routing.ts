export type AgrimarketRoute = {
  provider: "mapbox_driving";
  distanceKm: number;
  durationSeconds: number;
};

function finiteCoordinate(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("AGRIMARKET_INVALID_ROUTE_COORDINATE");
  return n;
}

export async function fetchAgrimarketDrivingRoute(
  originLat: unknown,
  originLng: unknown,
  destinationLat: unknown,
  destinationLng: unknown
): Promise<AgrimarketRoute> {
  const fromLat = finiteCoordinate(originLat);
  const fromLng = finiteCoordinate(originLng);
  const toLat = finiteCoordinate(destinationLat);
  const toLng = finiteCoordinate(destinationLng);

  if (fromLat < -90 || fromLat > 90 || toLat < -90 || toLat > 90) {
    throw new Error("AGRIMARKET_INVALID_ROUTE_LATITUDE");
  }
  if (fromLng < -180 || fromLng > 180 || toLng < -180 || toLng > 180) {
    throw new Error("AGRIMARKET_INVALID_ROUTE_LONGITUDE");
  }

  const token =
    process.env.MAPBOX_ACCESS_TOKEN ||
    process.env.MAPBOX_TOKEN ||
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
    "";

  if (!token) throw new Error("AGRIMARKET_MAPBOX_TOKEN_MISSING");

  const coordinates = `${fromLng},${fromLat};${toLng},${toLat}`;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}` +
    `?overview=false&alternatives=false&access_token=${encodeURIComponent(token)}`;

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`AGRIMARKET_ROUTE_HTTP_${response.status}`);
  }

  const payload: any = await response.json().catch(() => null);
  const route = Array.isArray(payload?.routes) ? payload.routes[0] : null;
  const distanceMeters = Number(route?.distance);
  const durationSeconds = Number(route?.duration);

  if (!route || !Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new Error("AGRIMARKET_ROUTE_DISTANCE_UNAVAILABLE");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new Error("AGRIMARKET_ROUTE_DURATION_UNAVAILABLE");
  }

  return {
    provider: "mapbox_driving",
    distanceKm: Math.round((distanceMeters / 1000) * 1000) / 1000,
    durationSeconds: Math.round(durationSeconds),
  };
}
