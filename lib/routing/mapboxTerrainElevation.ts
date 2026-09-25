import sharp from "sharp";
import type { RoadLineGeometry } from "./mapboxRoad";

export const MAPBOX_ELEVATION_SOURCE = "mapbox_terrain_rgb_v1";
export const MAPBOX_ELEVATION_VERSION = "terrain_rgb_z14_512_30m_median3_hysteresis3m_v1";
export const MAPBOX_FARE_PROVENANCE = "mapbox_road_terrain_rgb_v1";
const ZOOM = 14;
const TILE_SIZE = 512;
const SAMPLE_SPACING_M = 30;
const NOISE_THRESHOLD_M = 3;
const MAX_TILES = 16;
const CACHE_LIMIT = 64;
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;

export type ElevationValidationResult = {
  status: "validated" | "unavailable" | "invalid";
  source: string;
  version: string;
  cumulativePositiveElevationGainM: number | null;
  samplesRequested: number;
  samplesUsed: number;
  filteredOutlierCount: number;
  validationReason: string | null;
};

type Point = { latitude: number; longitude: number };
type Tile = { data: Buffer; channels: number };
const tiles = new Map<string, { expires: number; value: Promise<Tile> }>();

function result(
  status: ElevationValidationResult["status"],
  validationReason: string | null,
  samplesRequested = 0
): ElevationValidationResult {
  return {
    status, validationReason, samplesRequested,
    source: MAPBOX_ELEVATION_SOURCE,
    version: MAPBOX_ELEVATION_VERSION,
    cumulativePositiveElevationGainM: null,
    samplesUsed: 0,
    filteredOutlierCount: 0,
  };
}

// Geometry lengths are used only for sampling/validation, never for fare distance.
function separationM(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) *
    Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function sampleRoadLineGeometry(geometry: RoadLineGeometry | null): Point[] | null {
  if (!geometry || geometry.type !== "LineString" ||
      !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2 ||
      geometry.coordinates.length > 10000) return null;
  const points: Point[] = [];
  for (const coordinate of geometry.coordinates) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
    const [longitude, latitude] = coordinate;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        Math.abs(latitude) > 85.05112878 || Math.abs(longitude) > 180) return null;
    points.push({ latitude, longitude });
  }
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + separationM(points[i - 1], points[i]));
  }
  const length = distances[distances.length - 1];
  if (length > 3600) return null;
  if (length === 0) return [points[0], points[points.length - 1]];
  const intervals = Math.ceil(length / SAMPLE_SPACING_M);
  const sampled: Point[] = [];
  let segment = 1;
  for (let i = 0; i <= intervals; i++) {
    const target = length * i / intervals;
    while (segment < distances.length - 1 && distances[segment] < target) segment++;
    const span = distances[segment] - distances[segment - 1];
    const fraction = span === 0 ? 0 : (target - distances[segment - 1]) / span;
    const a = points[segment - 1];
    const b = points[segment];
    sampled.push({
      latitude: a.latitude + (b.latitude - a.latitude) * fraction,
      longitude: a.longitude + (b.longitude - a.longitude) * fraction,
    });
  }
  return sampled;
}

export function filterElevationNoise(values: number[]): {
  values: number[]; filteredOutlierCount: number;
} {
  const filtered = [...values];
  let filteredOutlierCount = 0;
  for (let i = 1; i < values.length - 1; i++) {
    const middle = [values[i - 1], values[i], values[i + 1]].sort((a, b) => a - b)[1];
    if (middle !== values[i]) { filtered[i] = middle; filteredOutlierCount++; }
  }
  return { values: filtered, filteredOutlierCount };
}

// Count complete climbs; small reversals do not create repeated billable gains.
// The threshold suppresses noise, it is not a deduction from each real climb.
export function computeCumulativePositiveElevationGain(values: number[]): number {
  if (values.length < 2) throw new RangeError("ELEVATION_SAMPLES_INSUFFICIENT");
  let valley = values[0];
  let peak = valley;
  let rising = false;
  let gain = 0;
  for (const value of values.slice(1)) {
    if (!rising) {
      valley = Math.min(valley, value);
      if (value - valley >= NOISE_THRESHOLD_M) { rising = true; peak = value; }
    } else {
      peak = Math.max(peak, value);
      if (peak - value >= NOISE_THRESHOLD_M) {
        gain += peak - valley;
        valley = value;
        rising = false;
      }
    }
  }
  if (rising) gain += peak - valley;
  return Number(gain.toFixed(3));
}

export function validateElevationValues(
  values: unknown, expectedCount: number, routeDistanceKm: number
): ElevationValidationResult {
  if (!Number.isFinite(routeDistanceKm) || routeDistanceKm < 0 ||
      !Number.isInteger(expectedCount) || expectedCount < 2 ||
      !Array.isArray(values) || values.length !== expectedCount) {
    return result("invalid", "elevation_sample_count_or_distance_invalid", expectedCount);
  }
  if (values.some(v => typeof v !== "number" || !Number.isFinite(v) || v < -1000 || v > 10000)) {
    return result("invalid", "elevation_sample_missing_or_out_of_range", expectedCount);
  }
  const filtered = filterElevationNoise(values);
  const spacingM = routeDistanceKm * 1000 / (expectedCount - 1);
  // Reject abrupt terrain/datum discontinuities instead of billing them.
  if (filtered.values.some((v, i, a) => i > 0 &&
      Math.abs(v - a[i - 1]) > Math.max(3, spacingM * 0.6))) {
    return result("invalid", "elevation_gradient_implausible", expectedCount);
  }
  return {
    ...result("validated", "median_filter_3_point_hysteresis_3m", expectedCount),
    samplesUsed: expectedCount,
    filteredOutlierCount: filtered.filteredOutlierCount,
    cumulativePositiveElevationGainM: computeCumulativePositiveElevationGain(filtered.values),
  };
}

function terrainPosition(point: Point) {
  const n = 2 ** ZOOM;
  const x = Math.min(n - Number.EPSILON * n, (point.longitude + 180) / 360 * n);
  const y = Math.max(0, Math.min(n - Number.EPSILON * n,
    (1 - Math.asinh(Math.tan(point.latitude * Math.PI / 180)) / Math.PI) / 2 * n));
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  return {
    key: `${ZOOM}/${tileX}/${tileY}`,
    x: Math.max(0, Math.min(TILE_SIZE - 1, (x - tileX) * TILE_SIZE - 0.5)),
    y: Math.max(0, Math.min(TILE_SIZE - 1, (y - tileY) * TILE_SIZE - 0.5)),
  };
}

async function fetchTile(key: string, token: string): Promise<Tile> {
  const cached = tiles.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (cached) tiles.delete(key);
  while (tiles.size >= CACHE_LIMIT) tiles.delete(tiles.keys().next().value!);
  const value = (async () => {
    const response = await fetch(
      `https://api.mapbox.com/v4/mapbox.terrain-rgb/${key}@2x.pngraw?access_token=${encodeURIComponent(token)}`,
      { cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!response.ok) throw new Error(`elevation_provider_http_${response.status}`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 2 * 1024 * 1024) throw new Error("elevation_tile_too_large");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 2 * 1024 * 1024 ||
        !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error("elevation_tile_not_png");
    }
    const decoder = sharp(buffer, { limitInputPixels: TILE_SIZE * TILE_SIZE });
    const metadata = await decoder.metadata();
    if (metadata.width !== TILE_SIZE || metadata.height !== TILE_SIZE ||
        metadata.depth !== "uchar" || ![3, 4].includes(metadata.channels || 0)) {
      throw new Error("elevation_tile_format_invalid");
    }
    const { data, info } = await decoder.raw().toBuffer({ resolveWithObject: true });
    return { data, channels: info.channels };
  })();
  const entry = { expires: Date.now() + CACHE_TTL_MS, value };
  tiles.set(key, entry);
  try { return await value; }
  catch (error) {
    if (tiles.get(key) === entry) tiles.delete(key);
    throw error;
  }
}

function interpolateHeight(tile: Tile, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, TILE_SIZE - 1), y1 = Math.min(y0 + 1, TILE_SIZE - 1);
  const pixel = (px: number, py: number) => {
    const i = (py * TILE_SIZE + px) * tile.channels;
    if (tile.channels === 4 && tile.data[i + 3] !== 255) return NaN;
    return -10000 + (tile.data[i] * 65536 + tile.data[i + 1] * 256 + tile.data[i + 2]) * 0.1;
  };
  const dx = x - x0, dy = y - y0;
  return (pixel(x0, y0) * (1 - dx) + pixel(x1, y0) * dx) * (1 - dy) +
    (pixel(x0, y1) * (1 - dx) + pixel(x1, y1) * dx) * dy;
}

export async function getValidatedCumulativePositiveElevationGain(
  geometry: RoadLineGeometry | null, routeDistanceKm: number
): Promise<ElevationValidationResult> {
  const points = sampleRoadLineGeometry(geometry);
  if (!points || !Number.isFinite(routeDistanceKm) || routeDistanceKm < 0 || routeDistanceKm > 3) {
    return result("invalid", "road_route_geometry_or_distance_invalid");
  }
  // A sparse shape is resampled, but a mismatched shape must not be priced.
  const coordinates = geometry!.coordinates.map(([longitude, latitude]) => ({ longitude, latitude }));
  const shapeLength = coordinates.reduce((sum, p, i) =>
    sum + (i ? separationM(coordinates[i - 1], p) : 0), 0);
  if (Math.abs(shapeLength - routeDistanceKm * 1000) > Math.max(30, routeDistanceKm * 200)) {
    return result("invalid", "road_geometry_distance_mismatch", points.length);
  }
  const token = [process.env.MAPBOX_ACCESS_TOKEN, process.env.MAPBOX_TOKEN,
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN, process.env.NEXT_PUBLIC_MAPBOX_TOKEN]
    .map(v => String(v || "").trim()).find(Boolean);
  if (!token) return result("unavailable", "elevation_provider_credentials_missing", points.length);
  const positions = points.map(terrainPosition);
  const keys = [...new Set(positions.map(p => p.key))];
  if (keys.length > MAX_TILES) return result("invalid", "elevation_tile_limit_exceeded", points.length);
  try {
    const loaded = new Map(await Promise.all(keys.map(async key => [key, await fetchTile(key, token)] as const)));
    const heights = positions.map(p => interpolateHeight(loaded.get(p.key)!, p.x, p.y));
    return validateElevationValues(heights, points.length, routeDistanceKm);
  } catch (error: any) {
    const reason = ["AbortError", "TimeoutError"].includes(error?.name) ? "elevation_provider_timeout" :
      /^elevation_(provider_http_\d{3}|tile_[a-z_]+)$/.test(String(error?.message))
        ? error.message : "elevation_provider_fetch_or_decode_failed";
    return result("unavailable", reason, points.length);
  }
}
