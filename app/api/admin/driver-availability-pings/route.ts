import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function env(name: string) {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : "";
}

function parseCsv(value: string) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function lowerList(values: string[]) {
  return values.map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function emailInList(email: string | null | undefined, values: string[]) {
  const normalized = String(email || "").trim().toLowerCase();
  return normalized ? values.includes(normalized) : false;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

async function getAuthorizedUser() {
  const session = await auth();
  const user = (session?.user || null) as
    | {
        id?: string | null;
        email?: string | null;
        name?: string | null;
        role?: string | null;
      }
    | null;

  if (!user) {
    return { ok: false as const, status: 401, error: "Not signed in" };
  }

  const email = String(user.email || "").trim().toLowerCase();
  const role = String(user.role || "user").trim().toLowerCase();
  const name = String(user.name || "").trim();
  const id = String(user.id || "").trim();

  const adminEmails = lowerList(
    parseCsv(env("JRIDE_ADMIN_EMAILS") || env("ADMIN_EMAILS"))
  );
  const dispatcherEmails = lowerList(
    parseCsv(env("JRIDE_DISPATCHER_EMAILS") || env("DISPATCHER_EMAILS"))
  );

  const isAdmin = role === "admin" || emailInList(email, adminEmails);
  const isDispatcher =
    role === "dispatcher" || emailInList(email, dispatcherEmails);

  if (!isAdmin && !isDispatcher) {
    return {
      ok: false as const,
      status: 403,
      error: "Forbidden (admin/dispatcher only).",
    };
  }

  return {
    ok: true as const,
    id,
    email,
    name,
    role: isAdmin ? "admin" : "dispatcher",
    isAdmin,
    isDispatcher,
  };
}

function clampInteger(
  rawValue: string | null,
  fallback: number,
  minimum: number,
  maximum: number
) {
  const parsed = Number.parseInt(String(rawValue || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function isoStartOfDay(rawValue: string | null) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;
  const date = new Date(raw + "T00:00:00+08:00");
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoEndOfDay(rawValue: string | null) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;
  const date = new Date(raw + "T23:59:59.999+08:00");
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function differenceSeconds(
  startValue: string | null | undefined,
  endValue: string | null | undefined
) {
  if (!startValue || !endValue) return null;
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

const DUTY_CHECK_STATE: Record<
  string,
  { label: string; badge_class: string; incentive_impact: string }
> = {
  pending_delivery: {
    label: "PENDING DELIVERY",
    badge_class: "border-amber-200 bg-amber-50 text-amber-800",
    incentive_impact: "None",
  },
  alerted_waiting_response: {
    label: "ALERTED - WAITING RESPONSE",
    badge_class: "border-sky-200 bg-sky-50 text-sky-800",
    incentive_impact: "None",
  },
  acknowledged_on_time: {
    label: "ACKNOWLEDGED ON TIME",
    badge_class: "border-emerald-200 bg-emerald-50 text-emerald-800",
    incentive_impact: "None",
  },
  acknowledged_late: {
    label: "ACKNOWLEDGED LATE",
    badge_class: "border-orange-200 bg-orange-50 text-orange-800",
    incentive_impact: "Miss retained; frozen interval excluded unless waived",
  },
  missed_timer_paused: {
    label: "MISSED - TIMER PAUSED",
    badge_class: "border-rose-300 bg-rose-100 text-rose-900",
    incentive_impact: "Counts as miss; eligible duty time paused",
  },
  missed_resolved: {
    label: "MISSED - RESOLVED",
    badge_class: "border-orange-200 bg-orange-50 text-orange-800",
    incentive_impact: "Review resolution; missed check may still count",
  },
  waived: {
    label: "WAIVED",
    badge_class: "border-emerald-300 bg-emerald-100 text-emerald-900",
    incentive_impact: "Excluded from missed-check ladder",
  },
  expired_not_alerted: {
    label: "EXPIRED - NOT ALERTED",
    badge_class: "border-orange-200 bg-orange-50 text-orange-800",
    incentive_impact: "None - device alert was not confirmed",
  },
  waiting_response: {
    label: "LEGACY - WAITING RESPONSE",
    badge_class: "border-sky-200 bg-sky-50 text-sky-800",
    incentive_impact: "None - legacy observation mode",
  },
  expired_not_delivered: {
    label: "LEGACY - NOT DELIVERED",
    badge_class: "border-orange-200 bg-orange-50 text-orange-800",
    incentive_impact: "None - legacy observation mode",
  },
  expired_no_response: {
    label: "LEGACY - EXPIRED NO RESPONSE",
    badge_class: "border-rose-200 bg-rose-50 text-rose-800",
    incentive_impact: "None - legacy observation mode",
  },
  acknowledged: {
    label: "LEGACY - ACKNOWLEDGED",
    badge_class: "border-emerald-200 bg-emerald-50 text-emerald-800",
    incentive_impact: "None - legacy observation mode",
  },
  cancelled: {
    label: "CANCELLED",
    badge_class: "border-slate-200 bg-slate-50 text-slate-700",
    incentive_impact: "None",
  },
};

function deriveDutyCheckState(
  ping: any,
  wasFetched: boolean,
  nowMs: number,
  wasWaived: boolean
) {
  const rawStatus = String(ping?.status || "").trim().toLowerCase();
  const lifecycleVersion = Number(ping?.lifecycle_version || 1);
  let code: keyof typeof DUTY_CHECK_STATE;

  if (wasWaived) {
    code = "waived";
  } else if (lifecycleVersion >= 2) {
    const resolutionKind = String(ping?.resolution_kind || "")
      .trim()
      .toLowerCase();
    const responseResult = String(ping?.response_result || "")
      .trim()
      .toLowerCase();

    if (rawStatus === "acknowledged") {
      code = "acknowledged_on_time";
    } else if (rawStatus === "cancelled") {
      code =
        resolutionKind === "delivery_expired_not_alerted" ||
        resolutionKind === "delivery_expired_not_presented"
          ? "expired_not_alerted"
          : "cancelled";
    } else if (rawStatus === "expired") {
      if (
        responseResult === "accepted_late" ||
        Boolean(ping?.late_acknowledged_at)
      ) {
        code = "acknowledged_late";
      } else if (
        Boolean(ping?.requires_late_ack) &&
        !ping?.timer_resumed_at
      ) {
        code = "missed_timer_paused";
      } else {
        code = "missed_resolved";
      }
    } else if (rawStatus === "pending") {
      code = ping?.alerted_at
        ? "alerted_waiting_response"
        : "pending_delivery";
    } else {
      code = "cancelled";
    }
  } else if (rawStatus === "acknowledged") {
    code = "acknowledged";
  } else if (rawStatus === "cancelled") {
    code = "cancelled";
  } else {
    const expiresMs = ping?.expires_at
      ? new Date(ping.expires_at).getTime()
      : Number.MAX_SAFE_INTEGER;
    const expired = Number.isFinite(expiresMs) && expiresMs <= nowMs;

    if (!expired) {
      code = wasFetched ? "waiting_response" : "pending_delivery";
    } else {
      code = wasFetched ? "expired_no_response" : "expired_not_delivered";
    }
  }

  return {
    code,
    ...DUTY_CHECK_STATE[code],
  };
}


const DRIVER_LOCATION_STALE_AFTER_SECONDS = 120;
const DRIVER_CAPABILITY_STALE_AFTER_SECONDS = 120;

// JRIDE_DUTY_CHECK_V2_CAPABILITY_DASHBOARD_V1
// Display-only readiness signal. Admin Send remains lifecycle v1 in this phase.
function driverCapabilityPresence(lock: any) {
  const deviceId = String(lock?.device_id || "").trim() || null;
  const lastSeen = String(lock?.last_seen || "").trim() || null;
  const capabilityLastSeenAt =
    String(lock?.capability_last_seen_at || "").trim() || null;

  const lastSeenMs = lastSeen ? Date.parse(lastSeen) : Number.NaN;
  const capabilitySeenMs = capabilityLastSeenAt
    ? Date.parse(capabilityLastSeenAt)
    : Number.NaN;

  const deviceAgeSeconds = Number.isFinite(lastSeenMs)
    ? Math.max(0, Math.floor((Date.now() - lastSeenMs) / 1000))
    : null;
  const capabilityAgeSeconds = Number.isFinite(capabilitySeenMs)
    ? Math.max(0, Math.floor((Date.now() - capabilitySeenMs) / 1000))
    : null;

  const rawVersionName =
    String(lock?.client_version_name || "").trim() || null;
  const rawVersionCode = Number(lock?.client_version_code);
  const versionCode =
    Number.isSafeInteger(rawVersionCode) && rawVersionCode >= 0
      ? rawVersionCode
      : null;

  const explicitlyCapable = lock?.duty_check_v2_capable === true;
  const isFresh =
    deviceAgeSeconds !== null &&
    capabilityAgeSeconds !== null &&
    deviceAgeSeconds <= DRIVER_CAPABILITY_STALE_AFTER_SECONDS &&
    capabilityAgeSeconds <= DRIVER_CAPABILITY_STALE_AFTER_SECONDS;

  const ready =
    explicitlyCapable &&
    isFresh &&
    Boolean(rawVersionName) &&
    versionCode !== null;

  return {
    device_id: deviceId,
    last_seen: lastSeen,
    device_age_seconds: deviceAgeSeconds,
    client_version_name: rawVersionName,
    client_version_code: versionCode,
    duty_check_v2_capable: explicitlyCapable,
    capability_last_seen_at: capabilityLastSeenAt,
    capability_age_seconds: capabilityAgeSeconds,
    capability_is_fresh: isFresh,
    duty_check_v2_ready: ready,
  };
}

const ONLINE_LIKE_DRIVER_STATUSES = new Set([
  "online",
  "available",
  "idle",
  "waiting",
]);

function driverLocationPresence(location: any) {
  const rawStatus = String(location?.status || "").trim().toLowerCase();
  const updatedAt = String(location?.updated_at || "").trim();
  const updatedMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const ageSeconds = Number.isFinite(updatedMs)
    ? Math.max(0, Math.floor((Date.now() - updatedMs) / 1000))
    : null;
  const isStale = ageSeconds === null || ageSeconds > DRIVER_LOCATION_STALE_AFTER_SECONDS;
  const isOnline = !isStale && ONLINE_LIKE_DRIVER_STATUSES.has(rawStatus);

  return {
    raw_status: rawStatus || null,
    effective_status: isOnline ? "online" : "offline",
    updated_at: updatedAt || null,
    age_seconds: ageSeconds,
    is_stale: isStale,
  };
}

async function loadDriverCatalog(admin: any) {
  const [
    driversResult,
    profilesResult,
    locationsResult,
    deviceLocksResult,
  ] = await Promise.all([
    admin
      .from("drivers")
      .select("id,driver_status,driver_name,updated_at")
      .order("driver_name", { ascending: true }),
    admin
      .from("driver_profiles")
      .select(
        "driver_id,full_name,callsign,municipality,vehicle_type,phone"
      )
      .order("full_name", { ascending: true }),
    admin
      .from("driver_locations_latest")
      .select(
        "driver_id,status,town,home_town,vehicle_type,updated_at"
      ),
    admin
      .from("driver_device_locks")
      .select(
        "driver_id,device_id,last_seen,client_version_name,client_version_code,duty_check_v2_capable,capability_last_seen_at"
      ),
  ]);

  for (const result of [
    driversResult,
    profilesResult,
    locationsResult,
    deviceLocksResult,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }

  const driversById = new Map(
    (driversResult.data || []).map((row: any) => [String(row.id), row])
  );
  const locationsById = new Map(
    (locationsResult.data || []).map((row: any) => [
      String(row.driver_id),
      row,
    ])
  );
  const deviceLocksById = new Map(
    (deviceLocksResult.data || []).map((row: any) => [
      String(row.driver_id),
      row,
    ])
  );

  const seen = new Set<string>();
  const catalog: any[] = [];

  for (const profile of profilesResult.data || []) {
    const driverId = String(profile.driver_id || "");
    if (!driverId || seen.has(driverId)) continue;
    seen.add(driverId);

    const driver: any = driversById.get(driverId) || {};
    const location: any = locationsById.get(driverId) || {};
    const deviceLock: any = deviceLocksById.get(driverId) || {};
    const presence = driverLocationPresence(location);
    const capability = driverCapabilityPresence(deviceLock);

    catalog.push({
      driver_id: driverId,
      driver_name:
        profile.full_name ||
        driver.driver_name ||
        profile.callsign ||
        "Unknown driver",
      callsign: profile.callsign || null,
      municipality:
        profile.municipality ||
        location.home_town ||
        location.town ||
        null,
      vehicle_type:
        profile.vehicle_type ||
        location.vehicle_type ||
        null,
      phone: profile.phone || null,
      online_status: presence.effective_status,
      raw_location_status: presence.raw_status,
      driver_status: driver.driver_status || null,
      location_updated_at: presence.updated_at,
      location_age_seconds: presence.age_seconds,
      location_is_stale: presence.is_stale,
      online_freshness_seconds: DRIVER_LOCATION_STALE_AFTER_SECONDS,

      active_device_id: capability.device_id,
      device_lock_last_seen: capability.last_seen,
      device_lock_age_seconds: capability.device_age_seconds,
      client_version_name: capability.client_version_name,
      client_version_code: capability.client_version_code,
      duty_check_v2_capable: capability.duty_check_v2_capable,
      capability_last_seen_at: capability.capability_last_seen_at,
      capability_age_seconds: capability.capability_age_seconds,
      capability_is_fresh: capability.capability_is_fresh,
      duty_check_v2_ready: capability.duty_check_v2_ready,
      capability_freshness_seconds:
        DRIVER_CAPABILITY_STALE_AFTER_SECONDS,
    });
  }

  return catalog.sort((a, b) =>
    String(a.driver_name || "").localeCompare(String(b.driver_name || ""))
  );
}

export async function GET(request: NextRequest) {
  try {
    const authorization = await getAuthorizedUser();
    if (!authorization.ok) {
      return NextResponse.json(
        { ok: false, error: authorization.error },
        { status: authorization.status }
      );
    }

    const params = request.nextUrl.searchParams;
    const status = String(params.get("status") || "").trim().toLowerCase();
    const town = String(params.get("town") || "").trim();
    const driverId = String(params.get("driver_id") || "").trim();
    const search = String(params.get("search") || "").trim().toLowerCase();
    const fromIso = isoStartOfDay(params.get("from"));
    const toIso = isoEndOfDay(params.get("to"));
    const limit = clampInteger(params.get("limit"), 250, 1, 1000);

    const admin = supabaseAdmin();

    let pingQuery = admin
      .from("driver_availability_pings")
      .select(
        "id,driver_id,status,created_at,expires_at,first_seen_at,last_fetched_at,fetch_count,responded_at,expired_at,cancelled_at,created_by,creation_source,response_device_id,response_http_received_at,response_result,notes,lifecycle_version,response_window_seconds,delivery_expires_at,alerted_at,alerted_device_id,presented_at,presented_device_id,response_expires_at,requires_late_ack,late_acknowledged_at,timer_frozen_at,timer_resumed_at,resolution_kind"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) pingQuery = pingQuery.eq("status", status);
    if (driverId) pingQuery = pingQuery.eq("driver_id", driverId);
    if (fromIso) pingQuery = pingQuery.gte("created_at", fromIso);
    if (toIso) pingQuery = pingQuery.lte("created_at", toIso);

    const [pingResult, driverCatalog] = await Promise.all([
      pingQuery,
      loadDriverCatalog(admin),
    ]);

    if (pingResult.error) {
      return NextResponse.json(
        { ok: false, error: pingResult.error.message },
        { status: 500 }
      );
    }

    const pings = Array.isArray(pingResult.data) ? pingResult.data : [];
    const pingIds = pings
      .map((ping: any) => String(ping?.id || "").trim())
      .filter(Boolean);

    let pingEvents: any[] = [];
    if (pingIds.length > 0) {
      const eventResult = await admin
        .from("driver_availability_ping_events")
        .select("id,ping_id,event_type,recorded_at,driver_id,device_id,metadata")
        .in("ping_id", pingIds)
        .order("recorded_at", { ascending: true });

      if (eventResult.error) {
        return NextResponse.json(
          { ok: false, error: eventResult.error.message },
          { status: 500 }
        );
      }

      pingEvents = Array.isArray(eventResult.data) ? eventResult.data : [];
    }

    const eventsByPingId = new Map<string, any[]>();
    for (const event of pingEvents) {
      const pingId = String(event?.ping_id || "").trim();
      if (!pingId) continue;
      const list = eventsByPingId.get(pingId) || [];
      list.push(event);
      eventsByPingId.set(pingId, list);
    }

    const catalogById = new Map(
      driverCatalog.map((row: any) => [String(row.driver_id), row])
    );

    const nowMs = Date.now();

    let rows = pings.map((ping: any) => {
      const driver: any = catalogById.get(String(ping.driver_id || "")) || {};
      const wasFetched = Boolean(ping.first_seen_at);
      const events = eventsByPingId.get(String(ping.id || "")) || [];
      const manualResponseEvent =
        [...events]
          .reverse()
          .find((event: any) => event.event_type === "manual_response_recorded") ||
        null;
      const waiverEvent =
        [...events]
          .reverse()
          .find((event: any) => event.event_type === "violation_waived") ||
        null;

      return {
        ...ping,
        driver_name: driver.driver_name || "Unknown driver",
        callsign: driver.callsign || null,
        municipality: driver.municipality || null,
        vehicle_type: driver.vehicle_type || null,
        phone: driver.phone || null,
        online_status: driver.online_status || "unknown",
        location_updated_at: driver.location_updated_at || null,
        response_seconds: differenceSeconds(
          Number(ping.lifecycle_version || 1) >= 2
            ? ping.alerted_at ||
                ping.presented_at ||
                ping.first_seen_at ||
                ping.created_at
            : ping.first_seen_at || ping.created_at,
          ping.responded_at
        ),
        fetch_delay_seconds: differenceSeconds(
          ping.created_at,
          ping.first_seen_at
        ),
        alert_delay_seconds: differenceSeconds(
          ping.created_at,
          ping.alerted_at
        ),
        presentation_delay_seconds: differenceSeconds(
          ping.alerted_at || ping.first_seen_at,
          ping.presented_at
        ),
        frozen_seconds: ping.timer_frozen_at
          ? differenceSeconds(
              ping.timer_frozen_at,
              ping.timer_resumed_at ||
                (ping.requires_late_ack
                  ? new Date(nowMs).toISOString()
                  : null)
            )
          : null,
        was_fetched: wasFetched,
        events,
        manual_response: manualResponseEvent
          ? {
              recorded_at: manualResponseEvent.recorded_at,
              response: manualResponseEvent.metadata?.response || null,
              channel: manualResponseEvent.metadata?.channel || null,
              note: manualResponseEvent.metadata?.note || null,
              admin_id: manualResponseEvent.metadata?.admin_id || null,
              admin_email: manualResponseEvent.metadata?.admin_email || null,
              admin_name: manualResponseEvent.metadata?.admin_name || null,
            }
          : null,
        violation_waiver: waiverEvent
          ? {
              recorded_at: waiverEvent.recorded_at,
              reason: waiverEvent.metadata?.reason || null,
              admin_id: waiverEvent.metadata?.admin_id || null,
              admin_email: waiverEvent.metadata?.admin_email || null,
              admin_name: waiverEvent.metadata?.admin_name || null,
            }
          : null,
        duty_check_state: deriveDutyCheckState(
          ping,
          wasFetched,
          nowMs,
          Boolean(waiverEvent)
        ),
      };
    });

    if (town) {
      const normalizedTown = town.toLowerCase();
      rows = rows.filter(
        (row: any) =>
          String(row.municipality || "").trim().toLowerCase() === normalizedTown
      );
    }

    if (search) {
      rows = rows.filter((row: any) => {
        const haystack = [
          row.driver_name,
          row.callsign,
          row.driver_id,
          row.phone,
          row.municipality,
          row.notes,
        ]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        return haystack.includes(search);
      });
    }

    const counts = {
      total: rows.length,
      lifecycle_v1: rows.filter(
        (row: any) => Number(row.lifecycle_version || 1) === 1
      ).length,
      lifecycle_v2: rows.filter(
        (row: any) => Number(row.lifecycle_version || 1) >= 2
      ).length,
      pending_delivery: rows.filter(
        (row: any) => row.duty_check_state.code === "pending_delivery"
      ).length,
      alerted_waiting_response: rows.filter(
        (row: any) =>
          row.duty_check_state.code === "alerted_waiting_response"
      ).length,
      acknowledged_on_time: rows.filter(
        (row: any) =>
          row.duty_check_state.code === "acknowledged_on_time"
      ).length,
      acknowledged_late: rows.filter(
        (row: any) => row.duty_check_state.code === "acknowledged_late"
      ).length,
      missed_timer_paused: rows.filter(
        (row: any) => row.duty_check_state.code === "missed_timer_paused"
      ).length,
      missed_resolved: rows.filter(
        (row: any) => row.duty_check_state.code === "missed_resolved"
      ).length,
      waived: rows.filter(
        (row: any) => row.duty_check_state.code === "waived"
      ).length,
      expired_not_alerted: rows.filter(
        (row: any) => row.duty_check_state.code === "expired_not_alerted"
      ).length,
      legacy_waiting_response: rows.filter(
        (row: any) => row.duty_check_state.code === "waiting_response"
      ).length,
      legacy_acknowledged: rows.filter(
        (row: any) => row.duty_check_state.code === "acknowledged"
      ).length,
      legacy_expired_not_delivered: rows.filter(
        (row: any) => row.duty_check_state.code === "expired_not_delivered"
      ).length,
      legacy_expired_no_response: rows.filter(
        (row: any) => row.duty_check_state.code === "expired_no_response"
      ).length,
      cancelled: rows.filter(
        (row: any) => row.duty_check_state.code === "cancelled"
      ).length,
      fetched: rows.filter((row: any) => row.was_fetched).length,
      never_fetched: rows.filter((row: any) => !row.was_fetched).length,
    };

    const acknowledgedRows = rows.filter(
      (row: any) =>
        [
          "acknowledged",
          "acknowledged_on_time",
          "acknowledged_late",
        ].includes(row.duty_check_state.code) &&
        typeof row.response_seconds === "number"
    );

    const averageResponseSeconds =
      acknowledgedRows.length > 0
        ? Math.round(
            acknowledgedRows.reduce(
              (sum: number, row: any) => sum + row.response_seconds,
              0
            ) / acknowledgedRows.length
          )
        : null;

    const acknowledgedCount =
      counts.legacy_acknowledged +
      counts.acknowledged_on_time +
      counts.acknowledged_late;

    const acknowledgementRate =
      counts.total > 0
        ? Math.round((acknowledgedCount / counts.total) * 1000) / 10
        : 0;

    const towns = Array.from(
      new Set(
        driverCatalog
          .map((row: any) => String(row.municipality || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    return NextResponse.json({
      ok: true,
      observation_mode: false,
      send_lifecycle_version: 1,
      send_lifecycle_mode: "capability_gated",
      v2_display_enabled: true,
      v2_send_enabled_for_ready_devices: true,
      legacy_v1_fallback_enabled: true,
      incentive_enforcement_enabled: true,
      generated_at: new Date().toISOString(),
      summary: {
        ...counts,
        acknowledgement_rate_percent: acknowledgementRate,
        average_response_seconds: averageResponseSeconds,
      },
      towns,
      drivers: driverCatalog,
      rows,
      auth_debug: {
        requester_email: authorization.email,
        requester_role: authorization.role,
        is_admin: authorization.isAdmin,
        is_dispatcher: authorization.isDispatcher,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: String(error?.message || error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authorization = await getAuthorizedUser();
    if (!authorization.ok) {
      return NextResponse.json(
        { ok: false, error: authorization.error },
        { status: authorization.status }
      );
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, code: "INVALID_JSON", error: "Request body must be valid JSON." },
        { status: 400 }
      );
    }

    const action = String(body?.action || "send").trim().toLowerCase();

    if (action === "manual_response" || action === "waive_violation") {
      const pingId = String(body?.ping_id || "").trim();

      if (!isUuid(pingId)) {
        return NextResponse.json(
          { ok: false, code: "INVALID_PING_ID", error: "Select a valid Duty Check." },
          { status: 400 }
        );
      }

      const admin = supabaseAdmin();
      const { data: ping, error: pingError } = await admin
        .from("driver_availability_pings")
        .select("id,driver_id,status,created_at,expires_at,responded_at,cancelled_at")
        .eq("id", pingId)
        .maybeSingle();

      if (pingError) {
        return NextResponse.json(
          { ok: false, code: "PING_READ_FAILED", error: pingError.message },
          { status: 500 }
        );
      }

      if (!ping) {
        return NextResponse.json(
          { ok: false, code: "PING_NOT_FOUND", error: "Duty Check was not found." },
          { status: 404 }
        );
      }

      const actorMetadata = {
        admin_id: isUuid(authorization.id) ? authorization.id : null,
        admin_email: authorization.email || null,
        admin_name: authorization.name || null,
        admin_role: authorization.role,
      };

      if (action === "manual_response") {
        const response = String(body?.response || "").trim().toLowerCase();
        const channel = String(body?.channel || "").trim().toLowerCase();
        const note = String(body?.note || "").trim();

        if (!["available", "not_available"].includes(response)) {
          return NextResponse.json(
            {
              ok: false,
              code: "INVALID_MANUAL_RESPONSE",
              error: "Manual response must be Available or Not available.",
            },
            { status: 400 }
          );
        }

        if (!["group_chat", "phone_call", "in_person", "other"].includes(channel)) {
          return NextResponse.json(
            {
              ok: false,
              code: "INVALID_RESPONSE_CHANNEL",
              error: "Select a valid response channel.",
            },
            { status: 400 }
          );
        }

        if (note.length < 5 || note.length > 500) {
          return NextResponse.json(
            {
              ok: false,
              code: "INVALID_MANUAL_RESPONSE_NOTE",
              error: "Enter a note between 5 and 500 characters.",
            },
            { status: 400 }
          );
        }

        const { data: event, error: eventError } = await admin
          .from("driver_availability_ping_events")
          .insert({
            ping_id: ping.id,
            event_type: "manual_response_recorded",
            driver_id: ping.driver_id,
            device_id: null,
            metadata: {
              response,
              channel,
              note,
              ...actorMetadata,
            },
          })
          .select("id,ping_id,event_type,recorded_at,driver_id,device_id,metadata")
          .single();

        if (eventError) {
          const duplicate =
            String(eventError.code || "") === "23505" ||
            String(eventError.message || "").toLowerCase().includes("duplicate");
          return NextResponse.json(
            {
              ok: false,
              code: duplicate
                ? "MANUAL_RESPONSE_ALREADY_RECORDED"
                : "MANUAL_RESPONSE_RECORD_FAILED",
              error: duplicate
                ? "A manual response has already been recorded for this Duty Check."
                : eventError.message,
            },
            { status: duplicate ? 409 : 500 }
          );
        }

        return NextResponse.json(
          {
            ok: true,
            action: "manual_response_recorded",
            ping,
            event,
          },
          { status: 201 }
        );
      }

      if (!authorization.isAdmin) {
        return NextResponse.json(
          {
            ok: false,
            code: "ADMIN_REQUIRED",
            error: "Only an administrator can waive an incentive violation.",
          },
          { status: 403 }
        );
      }

      const waiverReason = String(body?.reason || "").trim();
      if (waiverReason.length < 5 || waiverReason.length > 500) {
        return NextResponse.json(
          {
            ok: false,
            code: "INVALID_WAIVER_REASON",
            error: "Enter a waiver reason between 5 and 500 characters.",
          },
          { status: 400 }
        );
      }

      const { data: waiver, error: waiverError } = await admin.rpc(
        "jride_waive_driver_availability_ping",
        {
          p_ping_id: ping.id,
          p_admin_id: isUuid(authorization.id)
            ? authorization.id
            : null,
          p_admin_email: authorization.email || null,
          p_admin_name: authorization.name || null,
          p_admin_role: authorization.role,
          p_reason: waiverReason,
        }
      );

      if (waiverError) {
        return NextResponse.json(
          {
            ok: false,
            code: "VIOLATION_WAIVER_FAILED",
            error: waiverError.message,
          },
          { status: 500 }
        );
      }

      const waiverCode = String(waiver?.code || "").trim();
      const successfulWaiverCodes = new Set([
        "WAIVED_AND_RESUMED",
        "WAIVED_AFTER_LATE_ACK",
        "WAIVED_LEGACY",
        "ALREADY_WAIVED",
      ]);

      if (successfulWaiverCodes.has(waiverCode)) {
        return NextResponse.json(
          {
            ...waiver,
            ok: true,
            action: "violation_waived",
          },
          {
            status: waiverCode === "ALREADY_WAIVED" ? 200 : 201,
          }
        );
      }

      if (waiverCode === "PING_NOT_FOUND") {
        return NextResponse.json(waiver, { status: 404 });
      }

      if (
        waiverCode === "PING_NOT_WAIVABLE" ||
        waiverCode === "INVALID_WAIVER_REASON"
      ) {
        return NextResponse.json(waiver, { status: 409 });
      }

      return NextResponse.json(
        {
          ...waiver,
          ok: false,
          error:
            waiver?.message ||
            waiver?.code ||
            "Unable to waive Duty Check violation.",
        },
        { status: 400 }
      );
    }

    if (action !== "send") {
      return NextResponse.json(
        { ok: false, code: "INVALID_ACTION", error: "Unsupported Duty Check action." },
        { status: 400 }
      );
    }

    const driverId = String(body?.driver_id || "").trim();
    const reason = String(body?.reason || "").trim();

    if (!isUuid(driverId)) {
      return NextResponse.json(
        { ok: false, code: "INVALID_DRIVER_ID", error: "Select a valid driver." },
        { status: 400 }
      );
    }

    if (reason.length < 5) {
      return NextResponse.json(
        {
          ok: false,
          code: "REASON_REQUIRED",
          error: "Enter a reason with at least 5 characters.",
        },
        { status: 400 }
      );
    }

    if (reason.length > 300) {
      return NextResponse.json(
        {
          ok: false,
          code: "REASON_TOO_LONG",
          error: "Reason must not exceed 300 characters.",
        },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();
    const driverCatalog = await loadDriverCatalog(admin);
    const driver = driverCatalog.find(
      (item: any) => item.driver_id === driverId
    );

    if (!driver) {
      return NextResponse.json(
        { ok: false, code: "DRIVER_NOT_FOUND", error: "Driver was not found." },
        { status: 404 }
      );
    }

    if (String(driver.online_status || "").trim().toLowerCase() !== "online") {
      return NextResponse.json(
        {
          ok: false,
          code: "DRIVER_NOT_ONLINE",
          error: "Duty Check can only be sent to a currently online driver.",
          driver,
        },
        { status: 409 }
      );
    }

    const createdBy = isUuid(authorization.id)
      ? authorization.id
      : null;

    const senderLabel =
      authorization.name ||
      authorization.email ||
      authorization.role;

    // JRIDE_DUTY_CHECK_CAPABILITY_GATED_SEND_V1
    // V2 is allowed only when the same active device lock is currently
    // fresh and explicitly reports the verified Duty Check v2 capability.
    // All other drivers remain on legacy observation-only lifecycle v1.
    const sendLifecycleVersion =
      driver.duty_check_v2_ready === true ? 2 : 1;
    const isV2Send = sendLifecycleVersion === 2;

    const notes = [
      reason,
      "",
      "Sent by: " + senderLabel,
      "Role: " + authorization.role,
      authorization.email ? "Email: " + authorization.email : "",
      "Duty Check lifecycle: v" + sendLifecycleVersion,
      isV2Send
        ? "Capability gate: V2 READY active device"
        : "Capability gate: legacy v1 fallback",
      isV2Send
        ? "Incentive enforcement: enabled"
        : "Observation mode: no automatic incentive penalty",
      driver.client_version_name
        ? "Driver client: " +
          driver.client_version_name +
          " (" +
          String(driver.client_version_code ?? "-") +
          ")"
        : "",
      driver.active_device_id
        ? "Active device: " + driver.active_device_id
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const createResult = isV2Send
      ? await admin.rpc(
          "jride_create_driver_availability_ping_v2",
          {
            p_driver_id: driverId,
            p_created_by: createdBy,
            p_creation_source: authorization.role,
            p_notes: notes,
            p_response_window_seconds: 180,
            p_delivery_window_seconds: 180,
          }
        )
      : await admin.rpc(
          "jride_create_driver_availability_ping",
          {
            p_driver_id: driverId,
            p_created_by: createdBy,
            p_creation_source: authorization.role,
            p_notes: notes,
            p_response_window_seconds: 180,
          }
        );

    const data = createResult.data;
    const error = createResult.error;

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          code: "DUTY_CHECK_CREATE_FAILED",
          error: error.message,
          send_lifecycle_version: sendLifecycleVersion,
          capability_gated: true,
          driver,
        },
        { status: 500 }
      );
    }

    if (
      data?.code === "PING_ALREADY_PENDING" ||
      data?.code === "PING_ALREADY_UNRESOLVED"
    ) {
      return NextResponse.json(
        {
          ...data,
          ok: false,
          error:
            data?.code === "PING_ALREADY_UNRESOLVED"
              ? "This driver has an unresolved missed Duty Check that must be acknowledged or waived first."
              : "This driver already has a pending Duty Check.",
          send_lifecycle_version: sendLifecycleVersion,
          capability_gated: true,
          driver,
        },
        { status: 409 }
      );
    }

    if (data?.ok === false) {
      return NextResponse.json(
        {
          ...data,
          error:
            data?.message ||
            data?.code ||
            "Unable to create Duty Check.",
          send_lifecycle_version: sendLifecycleVersion,
          capability_gated: true,
          driver,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        ...data,
        driver,
        capability_gated: true,
        send_lifecycle_version: sendLifecycleVersion,
        observation_mode: !isV2Send,
        response_window_seconds: 180,
        delivery_window_seconds: isV2Send ? 180 : null,
        incentive_enforcement_enabled: isV2Send,
      },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        code: "DUTY_CHECK_CREATE_FAILED",
        error: String(error?.message || error),
      },
      { status: 500 }
    );
  }
}
