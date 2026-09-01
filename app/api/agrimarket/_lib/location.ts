const IFUGAO_TOWNS = [
  "Aguinaldo",
  "Alfonso Lista",
  "Asipulo",
  "Banaue",
  "Hingyon",
  "Hungduan",
  "Kiangan",
  "Lagawe",
  "Lamut",
  "Mayoyao",
  "Tinoc",
] as const;

const IFUGAO_TOWN_BY_KEY = new Map(
  IFUGAO_TOWNS.map((town) => [town.toLowerCase().replace(/[^a-z0-9]/g, ""), town])
);

function normalizeTownKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^municipality\s+of\s+/, "")
    .replace(/^municipality\s+/, "")
    .replace(/[^a-z0-9]/g, "");
}

export function normalizeIfugaoTown(value: unknown): string | null {
  const key = normalizeTownKey(value);
  return key ? IFUGAO_TOWN_BY_KEY.get(key) || null : null;
}

export async function reverseGeocodeIfugaoTown(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const token = String(
    process.env.MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || ""
  ).trim();
  if (!token) return null;

  const url = new URL("https://api.mapbox.com/search/geocode/v6/reverse");
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("types", "place");
  url.searchParams.set("country", "ph");
  url.searchParams.set("language", "en");
  url.searchParams.set("limit", "1");
  url.searchParams.set("access_token", token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload: any = await response.json().catch(() => null);
    const features = Array.isArray(payload?.features) ? payload.features : [];
    for (const feature of features) {
      const rawName = feature?.properties?.name || feature?.text || "";
      const town = normalizeIfugaoTown(rawName);
      if (town) return town;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
