const ONLINE_LIKE_STATUSES = new Set([
  "online",
  "available",
  "idle",
  "waiting",
]);

export const DUTY_CHECK_ONLINE_FRESHNESS_SECONDS = 120;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function norm(value: unknown): string {
  return text(value).toLowerCase();
}

export type DutyCheckOnlineState = {
  online: boolean;
  raw_status: string | null;
  updated_at: string | null;
  age_seconds: number | null;
  is_stale: boolean;
};

export async function getDriverDutyCheckOnlineState(
  admin: any,
  driverId: string
): Promise<DutyCheckOnlineState> {
  const { data, error } = await admin
    .from("driver_locations")
    .select("status,updated_at")
    .eq("driver_id", driverId)
    .maybeSingle();

  if (error) {
    throw new Error(
      "driver_locations duty-check presence lookup failed: " + error.message
    );
  }

  const rawStatus = norm(data?.status) || null;
  const updatedAt = text(data?.updated_at) || null;
  const updatedMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const ageSeconds = Number.isFinite(updatedMs)
    ? Math.max(0, Math.floor((Date.now() - updatedMs) / 1000))
    : null;

  const isStale =
    ageSeconds === null ||
    ageSeconds > DUTY_CHECK_ONLINE_FRESHNESS_SECONDS;

  const online =
    !isStale &&
    rawStatus !== null &&
    ONLINE_LIKE_STATUSES.has(rawStatus);

  return {
    online,
    raw_status: rawStatus,
    updated_at: updatedAt,
    age_seconds: ageSeconds,
    is_stale: isStale,
  };
}

export async function cancelPendingDutyChecksForOfflineDriver(
  admin: any,
  options: {
    driverId: string;
    source: string;
    deviceId?: string | null;
    presence?: DutyCheckOnlineState | null;
  }
) {
  const driverId = text(options.driverId);
  const source = text(options.source) || "driver_offline_guard";
  const deviceId = text(options.deviceId) || null;
  const nowIso = new Date().toISOString();

  if (!driverId) {
    return {
      ok: false,
      cancelled_count: 0,
      error: "DRIVER_ID_REQUIRED",
    };
  }

  const { data, error } = await admin
    .from("driver_availability_pings")
    .update({
      status: "cancelled",
      cancelled_at: nowIso,
      requires_late_ack: false,
      resolution_kind: "driver_offline",
    })
    .eq("driver_id", driverId)
    .eq("status", "pending")
    .select(
      "id,driver_id,lifecycle_version,created_at,alerted_at,presented_at,response_expires_at"
    );

  if (error) {
    throw new Error(
      "pending Duty Check offline cancellation failed: " + error.message
    );
  }

  const cancelled = Array.isArray(data) ? data : [];

  if (cancelled.length > 0) {
    const events = cancelled.map((ping: any) => ({
      ping_id: ping.id,
      event_type: "cancelled",
      recorded_at: nowIso,
      driver_id: driverId,
      device_id: deviceId,
      metadata: {
        cancel_source: "driver_offline",
        guard_source: source,
        lifecycle_version: Number(ping.lifecycle_version || 1),
        previous_alerted_at: ping.alerted_at || null,
        previous_presented_at: ping.presented_at || null,
        previous_response_expires_at: ping.response_expires_at || null,
        presence_status: options.presence?.raw_status || null,
        presence_updated_at: options.presence?.updated_at || null,
        presence_age_seconds: options.presence?.age_seconds ?? null,
      },
    }));

    const { error: eventError } = await admin
      .from("driver_availability_ping_events")
      .upsert(events, {
        onConflict: "ping_id,event_type",
        ignoreDuplicates: true,
      });

    if (eventError) {
      console.error(
        "[JRIDE_DUTY_CHECK_OFFLINE_CANCEL_AUDIT_FAILED]",
        eventError.message
      );
    }
  }

  return {
    ok: true,
    cancelled_count: cancelled.length,
    cancelled_ping_ids: cancelled.map((ping: any) => ping.id),
    cancelled_at: nowIso,
  };
}

export async function guardDriverOnlineForDutyCheck(
  admin: any,
  options: {
    driverId: string;
    source: string;
    deviceId?: string | null;
  }
) {
  const presence = await getDriverDutyCheckOnlineState(
    admin,
    options.driverId
  );

  if (presence.online) {
    return {
      online: true,
      presence,
      cancellation: null,
    };
  }

  const cancellation =
    await cancelPendingDutyChecksForOfflineDriver(admin, {
      driverId: options.driverId,
      source: options.source,
      deviceId: options.deviceId,
      presence,
    });

  return {
    online: false,
    presence,
    cancellation,
  };
}