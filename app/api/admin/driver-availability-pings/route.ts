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

async function loadDriverCatalog(admin: any) {
  const [driversResult, profilesResult, locationsResult] = await Promise.all([
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
  ]);

  for (const result of [driversResult, profilesResult, locationsResult]) {
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

  const seen = new Set<string>();
  const catalog: any[] = [];

  for (const profile of profilesResult.data || []) {
    const driverId = String(profile.driver_id || "");
    if (!driverId || seen.has(driverId)) continue;
    seen.add(driverId);

    const driver: any = driversById.get(driverId) || {};
    const location: any = locationsById.get(driverId) || {};

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
      online_status:
        location.status ||
        driver.driver_status ||
        "unknown",
      location_updated_at:
        location.updated_at ||
        driver.updated_at ||
        null,
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
        "id,driver_id,status,created_at,expires_at,first_seen_at,last_fetched_at,fetch_count,responded_at,expired_at,cancelled_at,created_by,creation_source,response_device_id,response_http_received_at,response_result,notes"
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
    const catalogById = new Map(
      driverCatalog.map((row: any) => [String(row.driver_id), row])
    );

    let rows = pings.map((ping: any) => {
      const driver: any = catalogById.get(String(ping.driver_id || "")) || {};

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
          ping.first_seen_at || ping.created_at,
          ping.responded_at
        ),
        fetch_delay_seconds: differenceSeconds(
          ping.created_at,
          ping.first_seen_at
        ),
        was_fetched: Boolean(ping.first_seen_at),
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
      pending: rows.filter((row: any) => row.status === "pending").length,
      acknowledged: rows.filter((row: any) => row.status === "acknowledged")
        .length,
      expired: rows.filter((row: any) => row.status === "expired").length,
      cancelled: rows.filter((row: any) => row.status === "cancelled").length,
      fetched: rows.filter((row: any) => row.was_fetched).length,
      never_fetched: rows.filter((row: any) => !row.was_fetched).length,
    };

    const acknowledgedRows = rows.filter(
      (row: any) =>
        row.status === "acknowledged" &&
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

    const acknowledgementRate =
      counts.total > 0
        ? Math.round((counts.acknowledged / counts.total) * 1000) / 10
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
      observation_mode: true,
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

    const notes = [
      reason,
      "",
      "Sent by: " + senderLabel,
      "Role: " + authorization.role,
      authorization.email ? "Email: " + authorization.email : "",
      "Observation mode: no automatic incentive penalty",
    ]
      .filter(Boolean)
      .join("\n");

    const { data, error } = await admin.rpc(
      "jride_create_driver_availability_ping",
      {
        p_driver_id: driverId,
        p_created_by: createdBy,
        p_creation_source: authorization.role,
        p_notes: notes,
        p_response_window_seconds: 180,
      }
    );

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          code: "DUTY_CHECK_CREATE_FAILED",
          error: error.message,
        },
        { status: 500 }
      );
    }

    if (data?.code === "PING_ALREADY_PENDING") {
      return NextResponse.json(
        {
          ...data,
          ok: false,
          error: "This driver already has a pending Duty Check.",
          driver,
        },
        { status: 409 }
      );
    }

    if (data?.ok === false) {
      return NextResponse.json(
        {
          ...data,
          error: data?.message || data?.code || "Unable to create Duty Check.",
          driver,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        ...data,
        driver,
        observation_mode: true,
        response_window_seconds: 180,
        incentive_enforcement_enabled: false,
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
