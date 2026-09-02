import { normalizeIfugaoTown } from "./location";

export const AGRIMARKET_LAUNCH_TOWNS = [
  "Lagawe",
  "Hingyon",
  "Kiangan",
  "Banaue",
  "Lamut",
] as const;

const LAUNCH_TOWN_SET = new Set<string>(AGRIMARKET_LAUNCH_TOWNS);

export type ResolvedFarmerLocation = {
  lat: number;
  lng: number;
  town: string;
  barangay: string | null;
  label: string;
  mapbox_id: string | null;
  launch_eligible: boolean;
};

function token(): string {
  return String(
    process.env.MAPBOX_ACCESS_TOKEN ||
      process.env.MAPBOX_TOKEN ||
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
      process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
      ""
  ).trim();
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function nodeName(node: any): string {
  return cleanText(
    node?.name ||
      node?.text ||
      node?.place_name ||
      node?.properties?.name ||
      node?.properties?.full_address ||
      ""
  );
}

function nodeType(node: any): string {
  const explicit = cleanText(node?.feature_type || node?.properties?.feature_type).toLowerCase();
  if (explicit) return explicit;
  return cleanText(node?.id).split(".")[0].toLowerCase();
}

function contextNodes(feature: any): any[] {
  const modernContext = feature?.properties?.context;
  const modernNodes =
    modernContext && typeof modernContext === "object" && !Array.isArray(modernContext)
      ? Object.values(modernContext)
      : [];
  const legacyNodes = Array.isArray(feature?.context) ? feature.context : [];
  return [feature, feature?.properties, ...modernNodes, ...legacyNodes].filter(Boolean);
}

function allFeatureText(feature: any): string {
  const values = [
    feature?.place_name,
    feature?.properties?.full_address,
    feature?.properties?.place_formatted,
    ...contextNodes(feature).map(nodeName),
  ];
  return values.map(cleanText).filter(Boolean).join(" | ");
}

function featureTown(feature: any): string | null {
  const nodes = contextNodes(feature);
  const ranked = ["place", "locality", "district", "neighborhood"];

  for (const type of ranked) {
    for (const node of nodes) {
      if (nodeType(node) !== type) continue;
      const town = normalizeIfugaoTown(nodeName(node));
      if (town) return town;
    }
  }

  for (const node of nodes) {
    const town = normalizeIfugaoTown(nodeName(node));
    if (town) return town;
  }

  return null;
}

function featureBarangay(feature: any, town: string): string | null {
  const nodes = contextNodes(feature);
  for (const type of ["neighborhood", "locality"]) {
    for (const node of nodes) {
      if (nodeType(node) !== type) continue;
      const name = nodeName(node);
      if (name && normalizeIfugaoTown(name) !== town) return name.slice(0, 100);
    }
  }
  return null;
}

function featureCoordinates(feature: any): { lat: number; lng: number } | null {
  const geometry = Array.isArray(feature?.geometry?.coordinates)
    ? feature.geometry.coordinates
    : null;
  const lng = Number(
    feature?.properties?.coordinates?.longitude ?? geometry?.[0]
  );
  const lat = Number(
    feature?.properties?.coordinates?.latitude ?? geometry?.[1]
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function featureLabel(feature: any, town: string, barangay: string | null): string {
  const name = nodeName(feature);
  const formatted = cleanText(
    feature?.properties?.full_address ||
      feature?.place_name ||
      feature?.properties?.place_formatted
  );
  if (formatted) return formatted.slice(0, 240);
  return [name, barangay, town, "Ifugao"].filter(Boolean).join(", ").slice(0, 240);
}

function parseFeature(feature: any): ResolvedFarmerLocation | null {
  const coordinates = featureCoordinates(feature);
  const town = featureTown(feature);
  if (!coordinates || !town) return null;

  const locationText = allFeatureText(feature).toLowerCase();
  if (!locationText.includes("ifugao")) return null;

  const barangay = featureBarangay(feature, town);
  return {
    ...coordinates,
    town,
    barangay,
    label: featureLabel(feature, town, barangay),
    mapbox_id: cleanText(feature?.id || feature?.properties?.mapbox_id) || null,
    launch_eligible: LAUNCH_TOWN_SET.has(town),
  };
}

async function mapboxJson(url: URL): Promise<any> {
  const accessToken = token();
  if (!accessToken) throw new Error("AGRIMARKET_MAPBOX_TOKEN_MISSING");
  url.searchParams.set("access_token", accessToken);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`AGRIMARKET_MAPBOX_REQUEST_FAILED_${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function reverseGeocodeFarmerPin(
  lat: number,
  lng: number
): Promise<ResolvedFarmerLocation | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const url = new URL("https://api.mapbox.com/search/geocode/v6/reverse");
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("types", "address,street,neighborhood,locality,place,district");
  url.searchParams.set("country", "ph");
  url.searchParams.set("language", "en");

  const payload = await mapboxJson(url);
  const features = Array.isArray(payload?.features) ? payload.features : [];
  for (const feature of features) {
    const parsed = parseFeature(feature);
    if (parsed) return { ...parsed, lat, lng };
  }
  return null;
}

export async function searchFarmerLocations(
  query: string
): Promise<ResolvedFarmerLocation[]> {
  const cleanQuery = cleanText(query).slice(0, 180);
  if (cleanQuery.length < 2) return [];

  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", cleanQuery);
  url.searchParams.set("country", "ph");
  url.searchParams.set("language", "en");
  url.searchParams.set("types", "address,street,neighborhood,locality,place");
  url.searchParams.set("autocomplete", "false");
  url.searchParams.set("limit", "10");

  const payload = await mapboxJson(url);
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const results: ResolvedFarmerLocation[] = [];
  const seen = new Set<string>();

  for (const feature of features) {
    const parsed = parseFeature(feature);
    if (!parsed || !parsed.launch_eligible) continue;
    const key = `${parsed.lat.toFixed(6)}:${parsed.lng.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(parsed);
    if (results.length >= 8) break;
  }

  return results;
}
