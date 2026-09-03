// lib/routing/mapboxRoad.ts
//
// Shared Mapbox road-routing helpers for JRide backend decisions.
// Billing and assignment helpers never fall back to straight-line/Haversine distance.

import { hasUsableLocationCoordinates } from "../location/coordinateValidity";

export type RoadPoint = {
  lat: number;
  lng: number;
};

export type RoadMetric = {
  distanceKm: number;
  durationSeconds: number | null;
};

export type RoadLineGeometry = {
  type: "LineString";
  coordinates: [number, number][];
};

export type RoadMetricWithGeometry = RoadMetric & {
  geometry: RoadLineGeometry | null;
};

export type RoadOrigin = RoadPoint & {
  id: string;
};

const MATRIX_MAX_COORDINATES = 25;
const MATRIX_MAX_ORIGINS_PER_TARGET = MATRIX_MAX_COORDINATES - 1;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function validCoordinate(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function validPoint(point: RoadPoint): boolean {
  return hasUsableLocationCoordinates(point.lat, point.lng);
}

function mergeMetrics(
  target: Map<string, RoadMetric>,
  source: Map<string, RoadMetric>
): void {
  for (const [id, metric] of source.entries()) {
    target.set(id, metric);
  }
}

async function isolateRoadMatrixFailure(
  target: RoadPoint,
  origins: RoadOrigin[]
): Promise<Map<string, RoadMetric>> {
  const output = new Map<string, RoadMetric>();
  if (origins.length === 0) return output;

  if (origins.length === 1) {
    return getRoadMatrixBatch(target, origins);
  }

  const midpoint = Math.ceil(origins.length / 2);
  const [left, right] = await Promise.all([
    getRoadMatrixBatch(target, origins.slice(0, midpoint)),
    getRoadMatrixBatch(target, origins.slice(midpoint)),
  ]);

  mergeMetrics(output, left);
  mergeMetrics(output, right);
  return output;
}

function mapboxToken(): string {
  const candidates = [
    process.env.MAPBOX_ACCESS_TOKEN,
    process.env.MAPBOX_TOKEN,
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  ];

  for (const candidate of candidates) {
    const token = text(candidate);
    if (token) return token;
  }

  return "";
}

function parseMetric(route: any): RoadMetric | null {
  const meters = Number(route?.distance ?? NaN);
  const seconds = Number(route?.duration ?? NaN);

  if (!Number.isFinite(meters) || meters < 0) return null;

  return {
    distanceKm: meters / 1000,
    durationSeconds:
      Number.isFinite(seconds) && seconds >= 0 ? seconds : null,
  };
}

function parseLineGeometry(route: any): RoadLineGeometry | null {
  const raw = route?.geometry;
  if (!raw || raw.type !== "LineString" || !Array.isArray(raw.coordinates)) {
    return null;
  }

  const coordinates: [number, number][] = [];
  for (const point of raw.coordinates) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    if (!validCoordinate(lat, -90, 90) || !validCoordinate(lng, -180, 180)) {
      continue;
    }
    coordinates.push([lng, lat]);
  }

  if (coordinates.length < 2) return null;
  return { type: "LineString", coordinates };
}

export async function getDrivingRoadRoute(
  from: RoadPoint,
  to: RoadPoint
): Promise<RoadMetric | null> {
  if (!validPoint(from) || !validPoint(to)) return null;

  const token = mapboxToken();
  if (!token) return null;

  const url =
    "https://api.mapbox.com/directions/v5/mapbox/driving/" +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?alternatives=false&overview=false&steps=false&access_token=${encodeURIComponent(token)}`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      console.error(
        "[MAPBOX_ROAD_ROUTE_ERROR]",
        response.status,
        await response.text()
      );
      return null;
    }

    const json = (await response.json().catch(() => ({}))) as any;
    const route = Array.isArray(json?.routes) ? json.routes[0] : null;
    return parseMetric(route);
  } catch (error: any) {
    console.error(
      "[MAPBOX_ROAD_ROUTE_EXCEPTION]",
      String(error?.message || error)
    );
    return null;
  }
}

export async function getDrivingRoadRouteWithGeometry(
  from: RoadPoint,
  to: RoadPoint
): Promise<RoadMetricWithGeometry | null> {
  if (!validPoint(from) || !validPoint(to)) return null;

  const token = mapboxToken();
  if (!token) return null;

  const url =
    "https://api.mapbox.com/directions/v5/mapbox/driving/" +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?alternatives=false&geometries=geojson&overview=simplified&steps=false&access_token=${encodeURIComponent(token)}`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      console.error(
        "[MAPBOX_ROAD_GEOMETRY_ERROR]",
        response.status,
        await response.text()
      );
      return null;
    }

    const json = (await response.json().catch(() => ({}))) as any;
    const route = Array.isArray(json?.routes) ? json.routes[0] : null;
    const metric = parseMetric(route);
    if (!metric) return null;

    return {
      ...metric,
      geometry: parseLineGeometry(route),
    };
  } catch (error: any) {
    console.error(
      "[MAPBOX_ROAD_GEOMETRY_EXCEPTION]",
      String(error?.message || error)
    );
    return null;
  }
}

async function getRoadMatrixBatch(
  target: RoadPoint,
  origins: RoadOrigin[]
): Promise<Map<string, RoadMetric>> {
  const output = new Map<string, RoadMetric>();

  if (!validPoint(target) || origins.length === 0) return output;

  const cleanOrigins = origins.filter(
    (origin) => text(origin.id) && validPoint(origin)
  );

  if (cleanOrigins.length === 0) return output;

  if (cleanOrigins.length === 1) {
    const origin = cleanOrigins[0];
    const metric = await getDrivingRoadRoute(origin, target);
    if (metric) output.set(origin.id, metric);
    return output;
  }

  const token = mapboxToken();
  if (!token) return output;

  const coordinates = [
    ...cleanOrigins.map((origin) => `${origin.lng},${origin.lat}`),
    `${target.lng},${target.lat}`,
  ].join(";");

  const destinationIndex = cleanOrigins.length;
  const sourceIndexes = cleanOrigins.map((_, index) => index).join(";");

  const url =
    `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coordinates}` +
    `?sources=${sourceIndexes}` +
    `&destinations=${destinationIndex}` +
    `&annotations=distance,duration` +
    `&access_token=${encodeURIComponent(token)}`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      const responseBody = await response.text();
      console.error(
        "[MAPBOX_ROAD_MATRIX_ERROR]",
        response.status,
        responseBody
      );

      if (response.status === 422 && cleanOrigins.length > 1) {
        console.warn("[MAPBOX_ROAD_MATRIX_ISOLATION]", {
          batch_size: cleanOrigins.length,
          status: response.status,
        });
        return isolateRoadMatrixFailure(target, cleanOrigins);
      }

      return output;
    }

    const json = (await response.json().catch(() => ({}))) as {
      code?: string;
      distances?: (number | null)[][];
      durations?: (number | null)[][];
    };

    if (json?.code && json.code !== "Ok") {
      console.error("[MAPBOX_ROAD_MATRIX_CODE]", json.code);
      return output;
    }

    const distances = Array.isArray(json?.distances) ? json.distances : [];
    const durations = Array.isArray(json?.durations) ? json.durations : [];

    cleanOrigins.forEach((origin, index) => {
      const meters = distances[index]?.[0];
      const seconds = durations[index]?.[0];

      if (typeof meters !== "number" || !Number.isFinite(meters) || meters < 0) {
        return;
      }

      output.set(origin.id, {
        distanceKm: meters / 1000,
        durationSeconds:
          typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
            ? seconds
            : null,
      });
    });

    return output;
  } catch (error: any) {
    console.error(
      "[MAPBOX_ROAD_MATRIX_EXCEPTION]",
      String(error?.message || error)
    );
    return output;
  }
}

export async function getDrivingRoadMetricsToTarget(
  target: RoadPoint,
  origins: RoadOrigin[]
): Promise<Map<string, RoadMetric>> {
  const output = new Map<string, RoadMetric>();

  const cleanOrigins = origins.filter(
    (origin) => text(origin.id) && validPoint(origin)
  );

  for (
    let index = 0;
    index < cleanOrigins.length;
    index += MATRIX_MAX_ORIGINS_PER_TARGET
  ) {
    const batch = cleanOrigins.slice(
      index,
      index + MATRIX_MAX_ORIGINS_PER_TARGET
    );
    const batchResult = await getRoadMatrixBatch(target, batch);

    mergeMetrics(output, batchResult);
  }

  return output;
}
