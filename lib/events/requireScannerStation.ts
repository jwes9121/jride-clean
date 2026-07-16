import { createHash } from "crypto";

export type ScannerStation = {
  id: string;
  eventId: string;
  stationName: string;
  expiresAt: string;
};

export type ScannerStationAuthorizationResult =
  | {
      ok: true;
      station: ScannerStation;
    }
  | {
      ok: false;
      status: 401;
      error: "STATION_TOKEN_REQUIRED" | "STATION_TOKEN_INVALID";
    };

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function requireScannerStation(
  supabase: any,
  eventId: string,
  plaintextToken: string
): Promise<ScannerStationAuthorizationResult> {
  const token = String(plaintextToken || "").trim();

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "STATION_TOKEN_REQUIRED",
    };
  }

  const tokenHash = sha256Hex(token);

  const { data: station, error } = await supabase
    .from("event_station_tokens")
    .select(
      "id,event_id,station_type,station_name,status,expires_at"
    )
    .eq("event_id", eventId)
    .eq("station_type", "scanner")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!station?.id || station.status !== "active") {
    return {
      ok: false,
      status: 401,
      error: "STATION_TOKEN_INVALID",
    };
  }

  const expiresAtMs = new Date(station.expires_at).getTime();
  const now = new Date();

  if (
    Number.isNaN(expiresAtMs) ||
    expiresAtMs <= now.getTime()
  ) {
    await supabase
      .from("event_station_tokens")
      .update({
        status: "expired",
        updated_at: now.toISOString(),
      })
      .eq("id", station.id)
      .eq("status", "active");

    return {
      ok: false,
      status: 401,
      error: "STATION_TOKEN_INVALID",
    };
  }

  const { error: usageError } = await supabase
    .from("event_station_tokens")
    .update({
      last_used_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", station.id)
    .eq("status", "active");

  if (usageError) {
    throw new Error(usageError.message);
  }

  return {
    ok: true,
    station: {
      id: station.id,
      eventId: station.event_id,
      stationName: station.station_name,
      expiresAt: station.expires_at,
    },
  };
}