export type VerificationLocationStatus =
  | "captured"
  | "denied"
  | "unavailable"
  | "timeout"
  | "error"
  | "not_provided";

export type VerificationLocationSnapshot = {
  status: VerificationLocationStatus;
  source: "browser_geolocation" | "client_geolocation";
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  captured_at: string | null;
};

export type VerificationNetworkLocation = {
  city: string | null;
  region: string | null;
  country: string | null;
};

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(number) ? number : null;
}

function validIso(value: unknown): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  return new Date(text).toISOString();
}

function cleanHeader(value: string | null): string | null {
  if (!value) return null;
  let text = value.trim();
  if (!text) return null;
  try {
    text = decodeURIComponent(text);
  } catch {
  }
  text = text.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return text ? text.slice(0, 120) : null;
}

export function normalizeVerificationLocation(
  input: Record<string, unknown>,
  source: VerificationLocationSnapshot["source"]
): VerificationLocationSnapshot {
  const latitude = finiteNumber(input.latitude);
  const longitude = finiteNumber(input.longitude);
  const accuracy = finiteNumber(input.accuracy_m);
  const hasCoordinates =
    latitude !== null &&
    longitude !== null &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;

  const allowed = new Set<VerificationLocationStatus>([
    "captured",
    "denied",
    "unavailable",
    "timeout",
    "error",
    "not_provided",
  ]);
  const rawStatus = String(input.status || "").trim().toLowerCase() as VerificationLocationStatus;
  let status: VerificationLocationStatus = allowed.has(rawStatus) ? rawStatus : "not_provided";

  if (hasCoordinates) status = "captured";
  else if (status === "captured") status = "error";

  return {
    status,
    source,
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
    accuracy_m: hasCoordinates && accuracy !== null && accuracy >= 0 && accuracy <= 100000 ? accuracy : null,
    captured_at: hasCoordinates ? validIso(input.captured_at) : null,
  };
}

export function verificationNetworkLocation(headers: Pick<Headers, "get">): VerificationNetworkLocation {
  return {
    city: cleanHeader(headers.get("x-vercel-ip-city")),
    region: cleanHeader(headers.get("x-vercel-ip-country-region")),
    country: cleanHeader(headers.get("x-vercel-ip-country")),
  };
}
