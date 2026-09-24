import type { RoadLineGeometry } from "./mapboxRoad";

export const OPEN_METEO_ELEVATION_SOURCE = "open_meteo_copernicus_glo90";
export const OPEN_METEO_ELEVATION_VERSION = "open_meteo_elevation_v1";
const MAX_ELEVATION_SAMPLES = 100;
const MIN_ELEVATION_M = -1000;
const MAX_ELEVATION_M = 10000;
const ELEVATION_REQUEST_TIMEOUT_MS = 5000;

export type ElevationValidationStatus = "validated" | "unavailable" | "invalid";

export type ElevationValidationResult = {
  status: ElevationValidationStatus;
  source: string;
  version: string;
  cumulativePositiveElevationGainM: number | null;
  samplesRequested: number;
  samplesUsed: number;
  filteredOutlierCount: number;
  validationReason: string | null;
};

type ElevationPoint = {
  latitude: number;
  longitude: number;
};

function validLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function validLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function validElevation(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_ELEVATION_M && value <= MAX_ELEVATION_M;
}

function invalidResult(
  status: ElevationValidationStatus,
  reason: string,
  samplesRequested = 0,
  samplesUsed = 0,
  filteredOutlierCount = 0
): ElevationValidationResult {
  return {
    status,
    source: OPEN_METEO_ELEVATION_SOURCE,
    version: OPEN_METEO_ELEVATION_VERSION,
    cumulativePositiveElevationGainM: null,
    samplesRequested,
    samplesUsed,
    filteredOutlierCount,
    validationReason: reason,
  };
}

export function sampleRoadLineGeometry(
  geometry: RoadLineGeometry | null,
  maxSamples = MAX_ELEVATION_SAMPLES
): ElevationPoint[] | null {
  if (!geometry || geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    return null;
  }

  const points = geometry.coordinates
    .map((coordinate) => {
      const longitude = Number(coordinate?.[0]);
      const latitude = Number(coordinate?.[1]);
      return validLatitude(latitude) && validLongitude(longitude)
        ? { latitude, longitude }
        : null;
    })
    .filter((point): point is ElevationPoint => point !== null);

  if (points.length < 2) return null;

  const limit = Math.max(2, Math.min(MAX_ELEVATION_SAMPLES, Math.floor(maxSamples)));
  if (points.length <= limit) return points;

  const sampled: ElevationPoint[] = [];
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round((index * (points.length - 1)) / (limit - 1));
    sampled.push(points[sourceIndex]);
  }
  return sampled;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

export function filterElevationNoise(values: number[]): {
  values: number[];
  filteredOutlierCount: number;
} {
  const filtered = [...values];
  let filteredOutlierCount = 0;

  for (let index = 1; index < values.length - 1; index += 1) {
    const neighbors = [values[index - 1], values[index], values[index + 1]];
    const localMedian = median(neighbors);
    if (values[index] !== localMedian) {
      filtered[index] = localMedian;
      filteredOutlierCount += 1;
    }
  }

  return { values: filtered, filteredOutlierCount };
}

export function computeCumulativePositiveElevationGain(values: number[]): number {
  if (values.length < 2) throw new RangeError("ELEVATION_SAMPLES_INSUFFICIENT");

  let gain = 0;
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    if (delta > 0) gain += delta;
  }
  return Number(gain.toFixed(3));
}

export function validateElevationValues(
  values: unknown,
  expectedCount: number,
  routeDistanceKm: number
): ElevationValidationResult {
  if (!Array.isArray(values) || values.length !== expectedCount) {
    return invalidResult(
      "invalid",
      "elevation_sample_count_mismatch",
      expectedCount,
      0
    );
  }

  const numericValues = values.map((value) =>
    value === null || value === undefined || value === "" ? Number.NaN : Number(value)
  );
  if (numericValues.some((value) => !validElevation(value))) {
    return invalidResult(
      "invalid",
      "elevation_sample_missing_or_out_of_range",
      expectedCount,
      0
    );
  }

  const filtered = filterElevationNoise(numericValues);
  const gain = computeCumulativePositiveElevationGain(filtered.values);
  const maximumPlausibleGain = Math.max(1000, routeDistanceKm * 1000);
  if (!Number.isFinite(gain) || gain < 0 || gain > maximumPlausibleGain) {
    return invalidResult(
      "invalid",
      "elevation_gain_out_of_plausible_range",
      expectedCount,
      filtered.values.length,
      filtered.filteredOutlierCount
    );
  }

  return {
    status: "validated",
    source: OPEN_METEO_ELEVATION_SOURCE,
    version: OPEN_METEO_ELEVATION_VERSION,
    cumulativePositiveElevationGainM: gain,
    samplesRequested: expectedCount,
    samplesUsed: filtered.values.length,
    filteredOutlierCount: filtered.filteredOutlierCount,
    validationReason:
      filtered.filteredOutlierCount > 0 ? "median_filter_3_point" : null,
  };
}

function elevationUrl(points: ElevationPoint[]): string {
  const latitude = points.map((point) => point.latitude.toFixed(6)).join(",");
  const longitude = points.map((point) => point.longitude.toFixed(6)).join(",");
  return `https://api.open-meteo.com/v1/elevation?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`;
}

export async function getValidatedCumulativePositiveElevationGain(
  geometry: RoadLineGeometry | null,
  routeDistanceKm: number
): Promise<ElevationValidationResult> {
  const points = sampleRoadLineGeometry(geometry);
  if (!points) {
    return invalidResult("invalid", "road_route_geometry_unavailable");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ELEVATION_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(elevationUrl(points), {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return invalidResult("unavailable", `elevation_provider_http_${response.status}`, points.length, 0);
    }

    const json = (await response.json().catch(() => null)) as any;
    return validateElevationValues(json?.elevation, points.length, routeDistanceKm);
  } catch (error: any) {
    const reason = error?.name === "AbortError" ? "elevation_provider_timeout" : "elevation_provider_fetch_failed";
    return invalidResult("unavailable", reason, points.length, 0);
  } finally {
    clearTimeout(timeout);
  }
}
