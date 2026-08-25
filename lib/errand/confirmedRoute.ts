import { getDrivingRoadRoute, type RoadPoint } from "@/lib/routing/mapboxRoad";

export type ErrandRoutePoint = RoadPoint & {
  key: string;
  label: string;
};

export type ErrandRouteLeg = {
  fromKey: string;
  fromLabel: string;
  toKey: string;
  toLabel: string;
  distanceKm: number;
  durationSeconds: number | null;
};

export type ErrandConfirmedRoute = {
  distanceKm: number;
  durationSeconds: number | null;
  legs: ErrandRouteLeg[];
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function validCoordinate(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function validPoint(point: ErrandRoutePoint): boolean {
  return (
    text(point.key).length > 0 &&
    text(point.label).length > 0 &&
    validCoordinate(point.lat, -90, 90) &&
    validCoordinate(point.lng, -180, 180)
  );
}

export async function getErrandConfirmedRoute(
  points: ErrandRoutePoint[]
): Promise<ErrandConfirmedRoute | null> {
  if (!Array.isArray(points) || points.length < 2) return null;
  if (!points.every(validPoint)) return null;

  const legs: ErrandRouteLeg[] = [];
  let distanceKm = 0;
  let durationSeconds = 0;
  let hasCompleteDuration = true;

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const metric = await getDrivingRoadRoute(from, to);

    // Billing must never fall back to straight-line distance.
    if (!metric) return null;

    distanceKm += metric.distanceKm;
    if (metric.durationSeconds == null) {
      hasCompleteDuration = false;
    } else {
      durationSeconds += metric.durationSeconds;
    }

    legs.push({
      fromKey: from.key,
      fromLabel: from.label,
      toKey: to.key,
      toLabel: to.label,
      distanceKm: Number(metric.distanceKm.toFixed(3)),
      durationSeconds: metric.durationSeconds,
    });
  }

  return {
    distanceKm: Number(distanceKm.toFixed(3)),
    durationSeconds: hasCompleteDuration ? Math.round(durationSeconds) : null,
    legs,
  };
}
