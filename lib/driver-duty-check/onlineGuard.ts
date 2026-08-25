const ONLINE_LIKE_STATUSES = new Set([
  "online",
  "available",
  "idle",
  "waiting",
]);

export const DUTY_CHECK_ONLINE_FRESHNESS_SECONDS = 120;
export const DUTY_CHECK_OFFLINE_DEBOUNCE_SECONDS = 5;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function norm(value: unknown): string {
  return text(value).toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function shouldDebounceOfflineCancellation(
  presence: DutyCheckOnlineState | null | undefined,
  hasAlertedV2Pending: boolean
): boolean {
  if (!hasAlertedV2Pending || !presence) return false;
  if (presence.online || presence.is_stale) return false;
  if (presence.raw_status !== "offline") return false;
  if (typeof presence.age_seconds !== "number") return false;

  return presence.age_seconds < DUTY_CHECK_OFFLINE_DEBOUNCE_SECONDS;
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

  if (!driverId) {
    return {
      ok: false,
      cancelled_count: 0,
      error: "DRIVER_ID_REQUIRED",
    };
  }

  const { data: pendingData, error: pendingError } = await admin
    .from("driver_availability_pings")
    .select("id,lifecycle_version,alerted_at,presented_at")
    .eq("driver_id", driverId)
    .eq("status", "pending");

  if (pendingError) {
    throw new Error(
      "pending Duty Check offline lookup failed: " + pendingError.message
    );
  }

  const pending = Array.isArray(pendingData) ? pendingData : [];

  if (pending.length === 0) {
    return {
      ok: true,
      cancelled_count: 0,
      cancelled_ping_ids: [],
      debounce_applied: false,
    };
  }

  const hasAlertedV2Pending = pending.some(
    (ping: any) =>
      Number(ping?.lifecycle_version || 1) === 2 &&
      !!ping?.alerted_at
  );

  let confirmedPresence = options.presence ?? null;
  let debounceApplied = false;

  if (
    shouldDebounceOfflineCancellation(
      confirmedPresence,
      hasAlertedV2Pending
    )
  ) {
    debounceApplied = true;

    const currentAgeSeconds = Math.max(
      0,
      Number(confirmedPresence?.age_seconds || 0)
    );
    const remainingSeconds = Math.max(
      0,
      DUTY_CHECK_OFFLINE_DEBOUNCE_SECONDS - currentAgeSeconds
    );

    await sleep(remainingSeconds * 1000 + 250);

    confirmedPresence = await getDriverDutyCheckOnlineState(
      admin,
      driverId
    );

    if (confirmedPresence.online) {
      return {
        ok: true,
        cancelled_count: 0,
        cancelled_ping_ids: [],
        debounce_applied: true,
        recovered_online: true,
        presence: confirmedPresence,
      };
    }
  }

  const nowIso = new Date().toISOString();

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
        presence_status: confirmedPresence?.raw_status || null,
        presence_updated_at: confirmedPresence?.updated_at || null,
        presence_age_seconds: confirmedPresence?.age_seconds ?? null,
        offline_debounce_applied: debounceApplied,
        offline_debounce_seconds: debounceApplied
          ? DUTY_CHECK_OFFLINE_DEBOUNCE_SECONDS
          : 0,
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
    debounce_applied: debounceApplied,
    recovered_online: false,
    presence: confirmedPresence,
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

  if (
    cancellation?.recovered_online === true &&
    cancellation?.presence?.online === true
  ) {
    return {
      online: true,
      presence: cancellation.presence,
      cancellation,
    };
  }

  return {
    online: false,
    presence: cancellation?.presence ?? presence,
    cancellation,
  };
}
