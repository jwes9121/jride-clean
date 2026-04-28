import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type AnyRow = Record<string, any>;

type DriverWorkforceRow = {
  driver_id: string | null;
  driver_name: string | null;
  town: string | null;
  municipality: string | null;
  today_online_minutes: number;
  week_online_minutes: number;
  month_online_minutes: number;
  today_login_count: number;
  week_qualified_days: number;
  month_qualified_days: number;
  accepted_bookings: number;
  assigned_bookings: number;
  completed_trips: number;
  last_seen_at: string | null;
  current_status: string | null;
  is_online_now: boolean;
};

type DriverCoverageGapRow = {
  town: string | null;
  date: string | null;
  start_at: string | null;
  end_at: string | null;
  minutes: number;
  label: string | null;
};

const PH_TZ = "Asia/Manila";
const ROSTER_ACTIVITY_DAYS = 30;

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function text(v: any): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function iso(d: Date): string {
  return d.toISOString();
}

function isOnlineStatus(status: any) {
  const s = String(status ?? "").trim().toLowerCase();
  return ["online", "available", "idle", "waiting", "on_trip", "on_the_way"].includes(s);
}

function driverIdFrom(row: AnyRow): string | null {
  return text(row.driver_id) || text(row.id) || text(row.user_id) || text(row.profile_id);
}

function driverNameFrom(row: AnyRow): string | null {
  return text(row.driver_name) || text(row.name) || text(row.full_name) || text(row.display_name) || text(row.legal_name);
}

function townFrom(row: AnyRow): string | null {
  return text(row.town) || text(row.municipality) || text(row.home_town) || text(row.homeTown) || text(row.city);
}

function statusFrom(row: AnyRow): string | null {
  return text(row.status) || text(row.current_status) || text(row.driver_status);
}

function lastSeenFrom(row: AnyRow): string | null {
  return text(row.last_seen_at) || text(row.updated_at) || text(row.created_at);
}

function truthyFlag(v: any): boolean | null {
  if (v === true) return true;
  if (v === false) return false;
  if (v == null) return null;

  const s = String(v).trim().toLowerCase();

  if (["true", "t", "yes", "y", "1", "active", "enabled", "approved", "verified"].includes(s)) return true;
  if (["false", "f", "no", "n", "0", "inactive", "disabled", "deactivated", "blocked", "suspended", "rejected", "archived", "deleted"].includes(s)) return false;

  return null;
}

function isDeactivatedDriverRow(row: AnyRow): boolean {
  const statusValues = [
    row.status,
    row.current_status,
    row.driver_status,
    row.account_status,
    row.approval_status,
    row.verification_status,
    row.lifecycle_status,
  ]
    .map((v) => String(v ?? "").trim().toLowerCase())
    .filter(Boolean);

  if (
    statusValues.some((s) =>
      ["deactivated", "inactive", "disabled", "blocked", "suspended", "archived", "deleted", "rejected"].includes(s)
    )
  ) {
    return true;
  }

  const activeFlags = [row.is_active, row.active, row.enabled, row.is_enabled];

  for (const flag of activeFlags) {
    const parsed = truthyFlag(flag);
    if (parsed === false) return true;
  }

  if (row.deactivated_at || row.disabled_at || row.blocked_at || row.deleted_at || row.archived_at) {
    return true;
  }

  return false;
}

async function safeSelect(supabase: any, table: string, query: (q: any) => any) {
  try {
    const { data, error } = await query(supabase.from(table).select("*"));

    if (error) {
      return { rows: [] as AnyRow[], error: error.message || String(error) };
    }

    return { rows: Array.isArray(data) ? (data as AnyRow[]) : [], error: null as string | null };
  } catch (err: any) {
    return { rows: [] as AnyRow[], error: err?.message || String(err) };
  }
}

function ensureDriver(map: Map<string, DriverWorkforceRow>, driver_id: string) {
  if (!map.has(driver_id)) {
    map.set(driver_id, {
      driver_id,
      driver_name: null,
      town: null,
      municipality: null,
      today_online_minutes: 0,
      week_online_minutes: 0,
      month_online_minutes: 0,
      today_login_count: 0,
      week_qualified_days: 0,
      month_qualified_days: 0,
      accepted_bookings: 0,
      assigned_bookings: 0,
      completed_trips: 0,
      last_seen_at: null,
      current_status: null,
      is_online_now: false,
    });
  }

  return map.get(driver_id)!;
}

function mergeIdentity(target: DriverWorkforceRow, source: Partial<DriverWorkforceRow>) {
  target.driver_name = target.driver_name || source.driver_name || null;
  target.town = target.town || source.town || source.municipality || null;
  target.municipality = target.municipality || source.municipality || source.town || null;
  target.last_seen_at = target.last_seen_at || source.last_seen_at || null;
  target.current_status = target.current_status || source.current_status || null;
}

function isRecentIso(value: string | null, cutoff: Date): boolean {
  if (!value) return false;

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) && ms >= cutoff.getTime();
}

function phDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PH_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export async function GET(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const url = new URL(req.url);

    const freshnessSeconds = Math.max(60, Math.min(900, num(url.searchParams.get("freshness_seconds")) || 180));
    const now = new Date();
    const activityStart = new Date(now.getTime() - ROSTER_ACTIVITY_DAYS * 24 * 60 * 60 * 1000);
    const freshCutoff = new Date(now.getTime() - freshnessSeconds * 1000);

    const [driverLocationsResult, profilesResult, bookingsResult] = await Promise.all([
      safeSelect(supabase, "driver_locations", (q) => q.gte("updated_at", iso(activityStart)).limit(5000)),
      safeSelect(supabase, "driver_profiles", (q) => q.limit(3000)),
      safeSelect(supabase, "bookings", (q) => q.gte("created_at", iso(activityStart)).limit(10000)),
    ]);

    const deactivatedDriverIds = new Set<string>();
    const profileByDriverId = new Map<string, AnyRow>();

    for (const p of profilesResult.rows) {
      const id = driverIdFrom(p);
      if (!id) continue;

      if (isDeactivatedDriverRow(p)) {
        deactivatedDriverIds.add(id);
        continue;
      }

      profileByDriverId.set(id, p);
    }

    const rowsByDriver = new Map<string, DriverWorkforceRow>();
    const rosterDriverIds = new Set<string>();

    for (const d of driverLocationsResult.rows) {
      const id = driverIdFrom(d);
      if (!id) continue;
      if (deactivatedDriverIds.has(id)) continue;
      if (isDeactivatedDriverRow(d)) continue;

      const lastSeen = lastSeenFrom(d);
      if (!isRecentIso(lastSeen, activityStart)) continue;

      rosterDriverIds.add(id);

      const row = ensureDriver(rowsByDriver, id);
      const status = statusFrom(d);
      const fresh = lastSeen ? new Date(lastSeen).getTime() >= freshCutoff.getTime() : false;

      mergeIdentity(row, {
        driver_name: driverNameFrom(d),
        town: townFrom(d),
        municipality: townFrom(d),
        current_status: status,
        last_seen_at: lastSeen,
      });

      row.current_status = status || row.current_status;
      row.last_seen_at = lastSeen || row.last_seen_at;
      row.is_online_now = fresh && isOnlineStatus(status);
    }

    for (const b of bookingsResult.rows) {
      const id = text(b.assigned_driver_id) || text(b.driver_id) || text(b.accepted_driver_id);
      if (!id) continue;
      if (deactivatedDriverIds.has(id)) continue;
      rosterDriverIds.add(id);
    }

    for (const id of rosterDriverIds) {
      const profile = profileByDriverId.get(id);
      const row = ensureDriver(rowsByDriver, id);

      if (profile) {
        mergeIdentity(row, {
          driver_name: driverNameFrom(profile),
          town: townFrom(profile),
          municipality: townFrom(profile),
          current_status: statusFrom(profile),
          last_seen_at: lastSeenFrom(profile),
        });
      }
    }

    for (const b of bookingsResult.rows) {
      const id = text(b.assigned_driver_id) || text(b.driver_id) || text(b.accepted_driver_id);
      if (!id) continue;
      if (deactivatedDriverIds.has(id)) continue;
      if (!rosterDriverIds.has(id)) continue;

      const row = ensureDriver(rowsByDriver, id);
      const status = String(b.status ?? "").trim().toLowerCase();

      if (text(b.assigned_driver_id) || text(b.driver_id)) {
        row.assigned_bookings += 1;
      }

      if (["accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip", "completed"].includes(status)) {
        row.accepted_bookings += 1;
      }

      if (status === "completed") {
        row.completed_trips += 1;
      }
    }

    const rows = Array.from(rowsByDriver.values())
      .filter((r) => !!r.driver_id)
      .filter((r) => !deactivatedDriverIds.has(String(r.driver_id)))
      .filter((r) => rosterDriverIds.has(String(r.driver_id)))
      .sort((a, b) => {
        if (Number(b.is_online_now) !== Number(a.is_online_now)) return Number(b.is_online_now) - Number(a.is_online_now);
        const bt = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
        const at = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
        if (bt !== at) return bt - at;
        return String(a.driver_name || a.driver_id || "").localeCompare(String(b.driver_name || b.driver_id || ""));
      });

    const activeDriversNow = rows.filter((r) => r.is_online_now).length;
    const gaps: DriverCoverageGapRow[] = [];

    return json({
      ok: true,
      source: {
        driver_locations_error: driverLocationsResult.error,
        driver_profiles_error: profilesResult.error,
        bookings_error: bookingsResult.error,
        excluded_deactivated_drivers: deactivatedDriverIds.size,
        roster_activity_days: ROSTER_ACTIVITY_DAYS,
        roster_source: "driver_locations_recent_activity_plus_bookings",
        profile_usage: "metadata_only",
        mode: "snapshot_only",
        note: "No driver session history table exists in production. This endpoint returns truthful live snapshot metrics only.",
      },
      policy: {
        freshness_seconds: freshnessSeconds,
        timezone: PH_TZ,
      },
      summary: {
        active_drivers_now: activeDriversNow,
        drivers_logged_in_today: 0,
        total_online_minutes_today: 0,
        avg_online_minutes_today: 0,
        qualified_today: 0,
        qualified_this_week: 0,
        no_driver_minutes_today: 0,
        worst_gap_start_at: null,
        worst_gap_end_at: null,
        worst_gap_minutes: 0,
        snapshot_date: phDate(now),
      },
      rows,
      gaps,
    });
  } catch (err: any) {
    console.error("DRIVER_WORKFORCE_ANALYTICS_UNEXPECTED", err);

    return json(
      {
        ok: false,
        error: "DRIVER_WORKFORCE_ANALYTICS_UNEXPECTED",
        message: err?.message || "Unexpected error",
      },
      500
    );
  }
}
