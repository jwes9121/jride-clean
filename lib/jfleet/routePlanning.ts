export type RoutePoint = { label: string; lat: number; lng: number; notes: string };
export type PlannedRoute = {
  provider: "mapbox";
  profile: "driving";
  geometry: { type: "LineString"; coordinates: number[][] };
  distance_m: number;
  duration_s: number;
  snapped_points: { lat: number; lng: number; distance_m: number }[];
};

export class RoutePlanningError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "RoutePlanningError";
    this.code = code;
    this.status = status;
  }
}

export const MAX_ROUTE_POINTS = 21;
export const MAX_SNAP_METERS = 250;
export const ROUTE_ADVISORY =
  "Planning route only. The operator must confirm road access, vehicle suitability, restrictions and the final itinerary. Driving time excludes stops and overnight stays.";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
export function validPin(lat: unknown, lng: unknown): boolean {
  return finite(lat) && finite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
export function parseRoutePoints(value: unknown): RoutePoint[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_ROUTE_POINTS) {
    throw new RoutePlanningError("JFLEET_ROUTE_POINTS_REQUIRED", "Pin the pickup and at least one destination, with no more than 21 points including the return.");
  }
  const result = value.map((item, index) => {
    const p = record(item);
    if (typeof p.label !== "string" || p.label.trim().length < 2 || p.label.length > 180) {
      throw new RoutePlanningError("JFLEET_ROUTE_LABEL_REQUIRED", "Every point needs a location label of 2 to 180 characters.");
    }
    if (!validPin(p.lat, p.lng)) {
      throw new RoutePlanningError("JFLEET_ROUTE_PIN_REQUIRED", "Confirm a map pin for point " + (index + 1) + ". Typed addresses alone are not pins.");
    }
    if (p.notes !== undefined && (typeof p.notes !== "string" || p.notes.length > 500)) {
      throw new RoutePlanningError("JFLEET_ROUTE_NOTES_INVALID", "Stop notes must be text of no more than 500 characters.");
    }
    return { label: p.label.trim(), lat: p.lat as number, lng: p.lng as number, notes: String(p.notes ?? "").trim() };
  });
  for (let i = 1; i < result.length; i += 1) {
    if (result[i].lat === result[i - 1].lat && result[i].lng === result[i - 1].lng) {
      throw new RoutePlanningError("JFLEET_ROUTE_DUPLICATE_POINT", "Consecutive stops cannot have the same pin. A round-trip return to the pickup is allowed after another destination.");
    }
  }
  return result;
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function parseDirections(body: unknown, points: RoutePoint[]): PlannedRoute {
  const data = record(body);
  if (data.code === "NoRoute" || data.code === "NoSegment") {
    throw new RoutePlanningError("JFLEET_NO_ROAD_ROUTE", "No road route was found near one or more pins. Check the pickup and destinations. No straight-line route will be substituted.", 422);
  }
  if (data.code !== "Ok" || !Array.isArray(data.routes) || !data.routes.length) {
    throw new RoutePlanningError("JFLEET_ROUTE_PROVIDER_RESPONSE", "The routing provider did not return a usable road route.", 502);
  }
  const route = record(data.routes[0]);
  const geometry = record(route.geometry);
  const coords = geometry.coordinates;
  if (geometry.type !== "LineString" || !Array.isArray(coords) || coords.length < 2 || coords.length > 100000 || coords.some(c => !Array.isArray(c) || c.length !== 2 || !validPin(c[1], c[0]))) {
    throw new RoutePlanningError("JFLEET_ROUTE_GEOMETRY_INVALID", "The road route geometry is invalid.", 502);
  }
  if (!finite(route.distance) || route.distance <= 0 || !finite(route.duration) || route.duration <= 0 || !Array.isArray(route.legs) || route.legs.length !== points.length - 1) {
    throw new RoutePlanningError("JFLEET_ROUTE_SUMMARY_INVALID", "The road route summary or stop order is incomplete.", 502);
  }
  if (!Array.isArray(data.waypoints) || data.waypoints.length !== points.length) {
    throw new RoutePlanningError("JFLEET_ROUTE_WAYPOINTS_INVALID", "The provider did not resolve every requested point.", 502);
  }
  const snapped = data.waypoints.map((raw, i) => {
    const w = record(raw);
    const loc = w.location;
    if (!Array.isArray(loc) || loc.length !== 2 || !validPin(loc[1], loc[0]) || !finite(w.distance) || w.distance < 0) {
      throw new RoutePlanningError("JFLEET_ROUTE_WAYPOINTS_INVALID", "A routed point is invalid.", 502);
    }
    const point = { lat: loc[1] as number, lng: loc[0] as number };
    if (w.distance > MAX_SNAP_METERS || distanceMeters(points[i], point) > MAX_SNAP_METERS) {
      throw new RoutePlanningError("JFLEET_ROUTE_PIN_TOO_FAR", "A pin is more than 250 meters from its routed road point. Move it to the intended accessible pickup or stop.", 422);
    }
    return { ...point, distance_m: w.distance };
  });
  return { provider: "mapbox", profile: "driving", geometry: { type: "LineString", coordinates: coords as number[][] }, distance_m: route.distance, duration_s: route.duration, snapped_points: snapped };
}

export async function requestRoadRoute(points: RoutePoint[], token: string, fetcher: typeof fetch = fetch): Promise<PlannedRoute> {
  if (!token.trim()) throw new RoutePlanningError("JFLEET_ROUTING_NOT_CONFIGURED", "Road routing is not configured. No quote request was submitted.", 503);
  // Validate again at the provider boundary. Never send unchecked coordinates to a URL.
  const checked = parseRoutePoints(points);
  const coordinates = checked.map(p => p.lng + "," + p.lat).join(";");
  const params = new URLSearchParams({ access_token: token, geometries: "geojson", overview: "full", alternatives: "false", steps: "false", radiuses: checked.map(() => String(MAX_SNAP_METERS)).join(";") });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetcher("https://api.mapbox.com/directions/v5/mapbox/driving/" + coordinates + "?" + params.toString(), { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new RoutePlanningError("JFLEET_ROUTING_UNAVAILABLE", "Road routing is temporarily unavailable. Please retry; no inquiry was submitted.", 503);
    return parseDirections(await response.json(), checked);
  } catch (error) {
    if (error instanceof RoutePlanningError) throw error;
    // Do not leak upstream URLs, tokens or exception messages to clients/logs.
    throw new RoutePlanningError("JFLEET_ROUTING_UNAVAILABLE", "Road routing is temporarily unavailable. Please retry; no inquiry was submitted.", 503);
  } finally {
    clearTimeout(timeout);
  }
}

export type InquiryDetails = {
  purpose: string; requested_vehicle_type: string; trip_mode: string;
  scheduled_start_at: string; scheduled_end_at: string;
  passenger_count: number | null; cargo_weight_kg: number | null;
  cargo_description: string | null; luggage_notes: string | null; special_notes: string | null;
};
export function parseInquiryDetails(value: unknown, now = Date.now()): InquiryDetails {
  const d = record(value);
  const choice = (key: string, allowed: string[]) => {
    const v = d[key];
    if (typeof v !== "string" || !allowed.includes(v)) throw new RoutePlanningError("JFLEET_DETAILS_INVALID", "Choose a valid " + key.replace(/_/g, " ") + ".");
    return v;
  };
  const date = (key: string) => {
    const v = d[key];
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/.test(v)) throw new RoutePlanningError("JFLEET_SCHEDULE_INVALID", "Use a valid Philippines date and time.");
    const n = Date.parse(v);
    if (!Number.isFinite(n) || new Date(n + 28800000).toISOString().slice(0,16) !== v.slice(0,16)) throw new RoutePlanningError("JFLEET_SCHEDULE_INVALID", "Use a valid calendar date and time.");
    return { text: v, time: n };
  };
  const start = date("scheduled_start_at"), end = date("scheduled_end_at");
  if (start.time <= now || end.time <= start.time) throw new RoutePlanningError("JFLEET_SCHEDULE_INVALID", "Departure must be in the future and trip end must be after departure.");
  const optionalNumber = (key: string, integer: boolean) => {
    const n = d[key];
    if (n === null || n === undefined) return null;
    if (!finite(n) || n <= 0 || (integer && !Number.isInteger(n))) throw new RoutePlanningError("JFLEET_DETAILS_INVALID", "Enter a valid " + key.replace(/_/g, " ") + ".");
    return n;
  };
  const optionalText = (key: string, max: number) => {
    const t = d[key];
    if (t === null || t === undefined) return null;
    if (typeof t !== "string" || t.length > max) throw new RoutePlanningError("JFLEET_DETAILS_INVALID", "Review " + key.replace(/_/g, " ") + ".");
    return t.trim() || null;
  };
  return {
    purpose: choice("purpose", ["tour_leisure","family","business","event","cargo_delivery","moving_hauling","other"]),
    requested_vehicle_type: choice("requested_vehicle_type", ["van","pickup","truck","recommend"]),
    trip_mode: choice("trip_mode", ["one_way","round_trip","multi_day"]),
    scheduled_start_at:start.text, scheduled_end_at:end.text,
    passenger_count:optionalNumber("passenger_count",true), cargo_weight_kg:optionalNumber("cargo_weight_kg",false),
    cargo_description:optionalText("cargo_description",1000), luggage_notes:optionalText("luggage_notes",1000), special_notes:optionalText("special_notes",1500),
  };
}
