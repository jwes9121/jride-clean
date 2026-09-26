import { parseUsableCoordinatePair } from "@/lib/location/coordinateValidity";

export const DRIVER_DISPATCH_FRESH_SECONDS = 120;
export const DRIVER_STANDBY_TTL_SECONDS = 30 * 60;

export type DriverDispatchLocationSource = "live_gps" | "standby";

export type DriverLocationCandidate = {
  driver_id?: string | null;
  lat?: unknown;
  lng?: unknown;
  town?: string | null;
  updated_at?: string | null;
};

export type DriverStandbyRow = {
  driver_id?: string | null;
  home_lat?: unknown;
  home_lng?: unknown;
  town?: string | null;
  address_hint?: string | null;
  confirmed_at?: string | null;
  expires_at?: string | null;
  consumed_at?: string | null;
  consumed_reason?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
};

export type DriverDispatchLocationResolution =
  | {
      ok: true;
      source: DriverDispatchLocationSource;
      driverId: string;
      lat: number;
      lng: number;
      town: string;
      freshAt: string;
      liveUpdatedAt: string | null;
      liveAgeSeconds: number | null;
      standbyConfirmedAt: string | null;
      standbyExpiresAt: string | null;
    }
  | {
      ok: false;
      source: null;
      driverId: string;
      reason:
        | "missing_driver_id"
        | "missing_location"
        | "missing_updated_at"
        | "invalid_updated_at"
        | "stale_live_gps"
        | "standby_cancelled"
        | "standby_consumed"
        | "standby_expired"
        | "standby_invalid"
        | "live_gps_newer_than_standby";
      liveUpdatedAt: string | null;
      liveAgeSeconds: number | null;
    };

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function parsedMs(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export function resolveDriverDispatchLocationCandidate(
  location: DriverLocationCandidate,
  standby: DriverStandbyRow | null | undefined,
  nowMs = Date.now(),
  freshnessSeconds = DRIVER_DISPATCH_FRESH_SECONDS
): DriverDispatchLocationResolution {
  const driverId = text(location?.driver_id);
  const liveUpdatedAt = text(location?.updated_at) || null;
  const liveUpdatedMs = parsedMs(liveUpdatedAt);
  const liveAgeSeconds =
    liveUpdatedMs == null
      ? null
      : Math.max(0, Math.floor((nowMs - liveUpdatedMs) / 1000));
  const liveCoords = parseUsableCoordinatePair(location?.lat, location?.lng);

  if (!driverId) {
    return {
      ok: false,
      source: null,
      driverId: "",
      reason: "missing_driver_id",
      liveUpdatedAt,
      liveAgeSeconds,
    };
  }

  if (
    liveCoords &&
    liveUpdatedMs != null &&
    liveAgeSeconds != null &&
    liveAgeSeconds <= freshnessSeconds
  ) {
    return {
      ok: true,
      source: "live_gps",
      driverId,
      lat: liveCoords.lat,
      lng: liveCoords.lng,
      town: text(location?.town),
      freshAt: liveUpdatedAt as string,
      liveUpdatedAt,
      liveAgeSeconds,
      standbyConfirmedAt: null,
      standbyExpiresAt: null,
    };
  }

  if (standby) {
    if (text(standby.cancelled_at)) {
      return {
        ok: false,
        source: null,
        driverId,
        reason: "standby_cancelled",
        liveUpdatedAt,
        liveAgeSeconds,
      };
    }

    if (text(standby.consumed_at)) {
      return {
        ok: false,
        source: null,
        driverId,
        reason: "standby_consumed",
        liveUpdatedAt,
        liveAgeSeconds,
      };
    }

    const confirmedAt = text(standby.confirmed_at);
    const expiresAt = text(standby.expires_at);
    const confirmedMs = parsedMs(confirmedAt);
    const expiresMs = parsedMs(expiresAt);
    const standbyCoords = parseUsableCoordinatePair(
      standby.home_lat,
      standby.home_lng
    );
    const standbyTown = text(standby.town);

    if (expiresMs != null && expiresMs <= nowMs) {
      return {
        ok: false,
        source: null,
        driverId,
        reason: "standby_expired",
        liveUpdatedAt,
        liveAgeSeconds,
      };
    }

    if (
      confirmedMs == null ||
      expiresMs == null ||
      !standbyCoords ||
      !standbyTown
    ) {
      return {
        ok: false,
        source: null,
        driverId,
        reason: "standby_invalid",
        liveUpdatedAt,
        liveAgeSeconds,
      };
    }

    // A later accepted live GPS fix permanently supersedes this standby
    // confirmation, even if that live fix becomes stale again later.
    if (liveUpdatedMs != null && liveUpdatedMs > confirmedMs) {
      return {
        ok: false,
        source: null,
        driverId,
        reason: "live_gps_newer_than_standby",
        liveUpdatedAt,
        liveAgeSeconds,
      };
    }

    return {
      ok: true,
      source: "standby",
      driverId,
      lat: standbyCoords.lat,
      lng: standbyCoords.lng,
      town: standbyTown,
      freshAt: confirmedAt,
      liveUpdatedAt,
      liveAgeSeconds,
      standbyConfirmedAt: confirmedAt,
      standbyExpiresAt: expiresAt,
    };
  }

  if (!liveCoords) {
    return {
      ok: false,
      source: null,
      driverId,
      reason: "missing_location",
      liveUpdatedAt,
      liveAgeSeconds,
    };
  }

  if (!liveUpdatedAt) {
    return {
      ok: false,
      source: null,
      driverId,
      reason: "missing_updated_at",
      liveUpdatedAt,
      liveAgeSeconds,
    };
  }

  if (liveUpdatedMs == null) {
    return {
      ok: false,
      source: null,
      driverId,
      reason: "invalid_updated_at",
      liveUpdatedAt,
      liveAgeSeconds,
    };
  }

  return {
    ok: false,
    source: null,
    driverId,
    reason: "stale_live_gps",
    liveUpdatedAt,
    liveAgeSeconds,
  };
}

export async function resolveDriverDispatchLocations(
  admin: any,
  locations: DriverLocationCandidate[],
  opts?: {
    nowMs?: number;
    freshnessSeconds?: number;
  }
): Promise<Map<string, DriverDispatchLocationResolution>> {
  const rows = Array.isArray(locations) ? locations : [];
  const driverIds = Array.from(
    new Set(rows.map((row) => text(row?.driver_id)).filter(Boolean))
  );
  const standbyByDriverId = new Map<string, DriverStandbyRow>();

  if (driverIds.length > 0) {
    const standbyRes = await admin
      .from("driver_standby_sessions")
      .select(
        "driver_id,home_lat,home_lng,town,address_hint,confirmed_at,expires_at,consumed_at,consumed_reason,cancelled_at,cancel_reason"
      )
      .in("driver_id", driverIds);

    if (standbyRes.error) {
      throw new Error(
        "DRIVER_STANDBY_READ_FAILED: " +
          text(standbyRes.error?.message || standbyRes.error)
      );
    }

    for (const row of Array.isArray(standbyRes.data) ? standbyRes.data : []) {
      const driverId = text((row as any)?.driver_id);
      if (driverId) standbyByDriverId.set(driverId, row as DriverStandbyRow);
    }
  }

  const result = new Map<string, DriverDispatchLocationResolution>();
  const nowMs = opts?.nowMs ?? Date.now();
  const freshnessSeconds =
    opts?.freshnessSeconds ?? DRIVER_DISPATCH_FRESH_SECONDS;

  for (const row of rows) {
    const driverId = text(row?.driver_id);
    if (!driverId) continue;
    result.set(
      driverId,
      resolveDriverDispatchLocationCandidate(
        row,
        standbyByDriverId.get(driverId) ?? null,
        nowMs,
        freshnessSeconds
      )
    );
  }

  return result;
}

export async function consumeDriverStandbyLocation(
  admin: any,
  input: {
    driverId: string;
    confirmedAt: string | null | undefined;
    reason: string;
  }
): Promise<{ ok: boolean; consumed: boolean; error?: string }> {
  const driverId = text(input.driverId);
  const confirmedAt = text(input.confirmedAt);
  const reason = text(input.reason).slice(0, 200);

  if (!driverId || !confirmedAt) {
    return { ok: true, consumed: false };
  }

  const nowIso = new Date().toISOString();
  const result = await admin
    .from("driver_standby_sessions")
    .update({
      consumed_at: nowIso,
      consumed_reason: reason || "dispatch_assignment",
      updated_at: nowIso,
    })
    .eq("driver_id", driverId)
    .eq("confirmed_at", confirmedAt)
    .is("consumed_at", null)
    .is("cancelled_at", null)
    .gt("expires_at", nowIso)
    .select("driver_id")
    .maybeSingle();

  if (result.error) {
    return {
      ok: false,
      consumed: false,
      error: text(result.error.message || result.error),
    };
  }

  return {
    ok: true,
    consumed: !!result.data?.driver_id,
  };
}
