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

type SessionRow = {
  driver_id: string;
  driver_name: string | null;
  town: string | null;
  municipality: string | null;
  login_at: string;
  logout_at: string | null;
};

const QUALIFIED_DAY_MINUTES = 8 * 60;
const QUALIFIED_WEEK_DAYS = 5;
const PH_TZ = "Asia/Manila";

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

function phParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PH_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function utcForPhLocal(year: number, month: number, day: number, hour = 0, minute = 0, second = 0) {
  // Philippines is UTC+8 with no DST. This keeps day/week/month scopes stable for JRide ops.
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second, 0));
}

function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfPhDay(now: Date) {
  const p = phParts(now);
  return utcForPhLocal(p.year, p.month, p.day, 0, 0, 0);
}

function startOfPhWeek(now: Date) {
  const dayStart = startOfPhDay(now);
  const phWeekday = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: PH_TZ, weekday: "short" })
      .formatToParts(now)
      .find((p) => p.type === "weekday")?.value === "Mon"
  );
  void phWeekday;
  const weekdayName = new Intl.DateTimeFormat("en-US", { timeZone: PH_TZ, weekday: "short" }).format(now);
  const index: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return addDays(dayStart, -(index[weekdayName] ?? 0));
}

function startOfPhMonth(now: Date) {
  const p = phParts(now);
  return utcForPhLocal(p.year, p.month, 1, 0, 0, 0);
}

function minutesBetween(startIso: string | null, endIso: string | null, rangeStart: Date, rangeEnd: Date): number {
  if (!startIso) return 0;
  const s = new Date(startIso).getTime();
  const e = endIso ? new Date(endIso).getTime() : Date.now();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
  const a = Math.max(s, rangeStart.getTime());
  const b = Math.min(e, rangeEnd.getTime());
  if (b <= a) return 0;
  return Math.floor((b - a) / 60000);
}

function phDateKeyFromIso(value: string) {
  const d = new Date(value);
  const p = phParts(d);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
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

async function safeSelect(supabase: any, table: string, query: (q: any) => any) {
  try {
    const { data, error } = await query(supabase.from(table).select("*"));
    if (error) return { rows: [] as AnyRow[], error: error.message || String(error) };
    return { rows: Array.isArray(data) ? (data as AnyRow[]) : [], error: null as string | null };
  } catch (err: any) {
    return { rows: [] as AnyRow[], error: err?.message || String(err) };
  }
}

function normalizeSession(row: AnyRow): SessionRow | null {
  const driver_id = driverIdFrom(row);
  const login_at = text(row.login_at) || text(row.online_at) || text(row.started_at) || text(row.start_at) || text(row.created_at);
  if (!driver_id || !login_at) return null;
  return {
    driver_id,
    driver_name: driverNameFrom(row),
    town: townFrom(row),
    municipality: townFrom(row),
    login_at,
    logout_at: text(row.logout_at) || text(row.offline_at) || text(row.ended_at) || text(row.end_at) || null,
  };
}

function ensureDriver(map: Map<string, DriverWorkforceRow>, driver_id: string | null) {
  const id = driver_id || "unknown";
  if (!map.has(id)) {
    map.set(id, {
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
  return map.get(id)!;
}

function mergeIdentity(target: DriverWorkforceRow, source: Partial<DriverWorkforceRow>) {
  target.driver_name = target.driver_name || source.driver_name || null;
  target.town = target.town || source.town || source.municipality || null;
  target.municipality = target.municipality || source.municipality || source.town || null;
  target.last_seen_at = target.last_seen_at || source.last_seen_at || null;
  target.current_status = target.current_status || source.current_status || null;
}

function buildCoverageGaps(sessions: SessionRow[], dayStart: Date, now: Date): DriverCoverageGapRow[] {
  if (!sessions.length) return [];
  const startMs = dayStart.getTime();
  const endMs = now.getTime();
  if (endMs <= startMs) return [];

  const towns = new Set<string>(["All towns"]);
  for (const s of sessions) {
    const t = s.town || s.municipality || "Unknown";
    towns.add(t);
  }

  const gaps: DriverCoverageGapRow[] = [];

  for (const town of Array.from(towns)) {
    let gapStart: number | null = null;
    let gapEnd: number | null = null;
    for (let t = startMs; t < endMs; t += 60000) {
      const active = sessions.some((s) => {
        const st = new Date(s.login_at).getTime();
        const en = s.logout_at ? new Date(s.logout_at).getTime() : now.getTime();
        const sameTown = town === "All towns" || (s.town || s.municipality || "Unknown") === town;
        return sameTown && st <= t && en > t;
      });
      if (!active) {
        if (gapStart == null) gapStart = t;
        gapEnd = t + 60000;
      } else if (gapStart != null && gapEnd != null) {
        gaps.push(makeGap(town, gapStart, gapEnd));
        gapStart = null;
        gapEnd = null;
      }
    }
    if (gapStart != null && gapEnd != null) gaps.push(makeGap(town, gapStart, gapEnd));
  }

  return gaps.sort((a, b) => b.minutes - a.minutes).slice(0, 20);
}

function makeGap(town: string, startMs: number, endMs: number): DriverCoverageGapRow {
  const start = new Date(startMs);
  const end = new Date(endMs);
  return {
    town,
    date: phDateKeyFromIso(start.toISOString()),
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    minutes: Math.max(0, Math.floor((endMs - startMs) / 60000)),
    label: `${formatPhTime(start)} - ${formatPhTime(end)}`,
  };
}

function formatPhTime(d: Date) {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: PH_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

export async function GET(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const url = new URL(req.url);
    const freshnessSeconds = Math.max(60, Math.min(900, num(url.searchParams.get("freshness_seconds")) || 180));
    const now = new Date();
    const dayStart = startOfPhDay(now);
    const dayEnd = addDays(dayStart, 1);
    const weekStart = startOfPhWeek(now);
    const monthStart = startOfPhMonth(now);
    const freshCutoff = new Date(now.getTime() - freshnessSeconds * 1000);

    const [driverLocationsResult, sessionsResult, profilesResult, bookingsResult] = await Promise.all([
      safeSelect(supabase, "driver_locations", (q) => q.limit(2000)),
      safeSelect(supabase, "driver_presence_sessions", (q) => q.gte("login_at", iso(monthStart)).limit(10000)),
      safeSelect(supabase, "driver_profiles", (q) => q.limit(3000)),
      safeSelect(supabase, "bookings", (q) => q.gte("created_at", iso(monthStart)).limit(10000)),
    ]);

    const rowsByDriver = new Map<string, DriverWorkforceRow>();

    for (const p of profilesResult.rows) {
      const id = driverIdFrom(p);
      if (!id) continue;
      const row = ensureDriver(rowsByDriver, id);
      mergeIdentity(row, {
        driver_name: driverNameFrom(p),
        town: townFrom(p),
        municipality: townFrom(p),
        current_status: statusFrom(p),
        last_seen_at: lastSeenFrom(p),
      });
    }

    for (const d of driverLocationsResult.rows) {
      const id = driverIdFrom(d);
      if (!id) continue;
      const status = statusFrom(d);
      const lastSeen = lastSeenFrom(d);
      const fresh = lastSeen ? new Date(lastSeen).getTime() >= freshCutoff.getTime() : false;
      const onlineNow = fresh && isOnlineStatus(status);
      const row = ensureDriver(rowsByDriver, id);
      mergeIdentity(row, {
        driver_name: driverNameFrom(d),
        town: townFrom(d),
        municipality: townFrom(d),
        current_status: status,
        last_seen_at: lastSeen,
      });
      row.current_status = status || row.current_status;
      row.last_seen_at = lastSeen || row.last_seen_at;
      row.is_online_now = onlineNow;
    }

    const sessions = sessionsResult.rows.map(normalizeSession).filter(Boolean) as SessionRow[];
    const dayMinutesByDriverDate = new Map<string, number>();

    for (const s of sessions) {
      const row = ensureDriver(rowsByDriver, s.driver_id);
      mergeIdentity(row, {
        driver_name: s.driver_name,
        town: s.town,
        municipality: s.municipality,
      });

      const todayMins = minutesBetween(s.login_at, s.logout_at, dayStart, now);
      const weekMins = minutesBetween(s.login_at, s.logout_at, weekStart, now);
      const monthMins = minutesBetween(s.login_at, s.logout_at, monthStart, now);
      row.today_online_minutes += todayMins;
      row.week_online_minutes += weekMins;
      row.month_online_minutes += monthMins;

      const loginTime = new Date(s.login_at).getTime();
      if (loginTime >= dayStart.getTime() && loginTime < dayEnd.getTime()) row.today_login_count += 1;

      // Split sessions into PH day buckets for qualified day counting.
      let cursor = new Date(Math.max(new Date(s.login_at).getTime(), monthStart.getTime()));
      const sessionEnd = new Date(Math.min(s.logout_at ? new Date(s.logout_at).getTime() : now.getTime(), now.getTime()));
      while (cursor < sessionEnd) {
        const key = phDateKeyFromIso(cursor.toISOString());
        const p = phParts(cursor);
        const nextDay = addDays(utcForPhLocal(p.year, p.month, p.day, 0, 0, 0), 1);
        const mins = minutesBetween(s.login_at, s.logout_at, cursor, nextDay < sessionEnd ? nextDay : sessionEnd);
        const mapKey = `${s.driver_id}|${key}`;
        dayMinutesByDriverDate.set(mapKey, (dayMinutesByDriverDate.get(mapKey) || 0) + mins);
        cursor = nextDay;
      }
    }

    for (const [key, mins] of dayMinutesByDriverDate.entries()) {
      const [driverId, dateKey] = key.split("|");
      const row = ensureDriver(rowsByDriver, driverId);
      if (mins >= QUALIFIED_DAY_MINUTES) {
        row.month_qualified_days += 1;
        const dateStart = new Date(`${dateKey}T00:00:00+08:00`);
        if (dateStart.getTime() >= weekStart.getTime()) row.week_qualified_days += 1;
      }
    }

    for (const b of bookingsResult.rows) {
      const id = text(b.assigned_driver_id) || text(b.driver_id) || text(b.accepted_driver_id);
      if (!id) continue;
      const row = ensureDriver(rowsByDriver, id);
      const status = String(b.status ?? "").trim().toLowerCase();
      if (text(b.assigned_driver_id) || text(b.driver_id)) row.assigned_bookings += 1;
      if (["accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip", "completed"].includes(status)) row.accepted_bookings += 1;
      if (status === "completed") row.completed_trips += 1;
    }

    const rows = Array.from(rowsByDriver.values())
      .filter((r) => r.driver_id || r.driver_name || r.is_online_now || r.today_online_minutes > 0 || r.month_online_minutes > 0)
      .sort((a, b) => {
        if (b.today_online_minutes !== a.today_online_minutes) return b.today_online_minutes - a.today_online_minutes;
        if (b.week_qualified_days !== a.week_qualified_days) return b.week_qualified_days - a.week_qualified_days;
        return String(a.driver_name || a.driver_id || "").localeCompare(String(b.driver_name || b.driver_id || ""));
      });

    const activeDriversNow = rows.filter((r) => r.is_online_now).length;
    const driversLoggedInToday = rows.filter((r) => r.today_login_count > 0 || r.today_online_minutes > 0 || r.is_online_now).length;
    const totalOnlineMinutesToday = rows.reduce((sum, r) => sum + r.today_online_minutes, 0);
    const avgOnlineMinutesToday = driversLoggedInToday ? Math.round(totalOnlineMinutesToday / driversLoggedInToday) : 0;
    const qualifiedToday = rows.filter((r) => r.today_online_minutes >= QUALIFIED_DAY_MINUTES).length;
    const qualifiedThisWeek = rows.filter((r) => r.week_qualified_days >= QUALIFIED_WEEK_DAYS).length;

    const gaps = buildCoverageGaps(sessions.filter((s) => minutesBetween(s.login_at, s.logout_at, dayStart, now) > 0), dayStart, now);
    const allTownsGap = gaps.find((g) => g.town === "All towns") || null;
    const worstGap = gaps[0] || null;

    return json({
      ok: true,
      source: {
        driver_locations_error: driverLocationsResult.error,
        driver_presence_sessions_error: sessionsResult.error,
        driver_profiles_error: profilesResult.error,
        bookings_error: bookingsResult.error,
        has_session_data: sessions.length > 0,
        mode: sessions.length > 0 ? "sessions" : "snapshot_only",
      },
      policy: {
        qualified_day_minutes: QUALIFIED_DAY_MINUTES,
        qualified_week_days: QUALIFIED_WEEK_DAYS,
        freshness_seconds: freshnessSeconds,
        timezone: PH_TZ,
      },
      summary: {
        active_drivers_now: activeDriversNow,
        drivers_logged_in_today: driversLoggedInToday,
        total_online_minutes_today: totalOnlineMinutesToday,
        avg_online_minutes_today: avgOnlineMinutesToday,
        qualified_today: qualifiedToday,
        qualified_this_week: qualifiedThisWeek,
        no_driver_minutes_today: allTownsGap?.minutes || 0,
        worst_gap_start_at: worstGap?.start_at || null,
        worst_gap_end_at: worstGap?.end_at || null,
        worst_gap_minutes: worstGap?.minutes || 0,
      },
      rows,
      gaps,
    });
  } catch (err: any) {
    console.error("DRIVER_WORKFORCE_ANALYTICS_UNEXPECTED", err);
    return json({ ok: false, error: "DRIVER_WORKFORCE_ANALYTICS_UNEXPECTED", message: err?.message || "Unexpected error" }, 500);
  }
}
