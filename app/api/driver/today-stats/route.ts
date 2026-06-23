import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type AnyRow = Record<string, any>;
type ServiceKey = "rides" | "takeout";

function withNoStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function text(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function completedAt(row: AnyRow): Date | null {
  const raw = row.completed_at || row.completedAt || row.dropoff_at || row.updated_at || row.created_at;
  if (!raw) return null;
  const d = new Date(String(raw));
  return Number.isFinite(d.getTime()) ? d : null;
}

function manilaDateKey(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find((p) => p.type === "year")?.value || "0000";
  const m = parts.find((p) => p.type === "month")?.value || "00";
  const day = parts.find((p) => p.type === "day")?.value || "00";
  return `${y}-${m}-${day}`;
}

function manilaDayStart(date = new Date()): Date {
  return new Date(`${manilaDateKey(date)}T00:00:00+08:00`);
}

function manilaMonthStart(date = new Date()): Date {
  const key = manilaDateKey(date);
  return new Date(`${key.slice(0, 7)}-01T00:00:00+08:00`);
}

function manilaWeekStart(date = new Date()): Date {
  const start = manilaDayStart(date);
  const day = start.getDay();
  const diff = (day + 6) % 7;
  start.setDate(start.getDate() - diff);
  return start;
}

function serviceType(row: AnyRow): ServiceKey {
  const explicit = text(row.service_type || row.serviceType || row.trip_type || row.tripType).toLowerCase();
  if (explicit.includes("takeout") || explicit.includes("food") || explicit.includes("delivery")) return "takeout";

  if (
    row.takeout_total_payable != null ||
    row.takeout_service_fee != null ||
    row.takeout_delivery_fee != null ||
    row.vendor_status != null ||
    row.vendor_id != null
  ) {
    return "takeout";
  }

  return "rides";
}


function mergedOnlineMinutes(rows: AnyRow[], windowStart: Date, windowEnd: Date): number {
  const intervals = rows
    .map((row) => {
      const startMs = new Date(String(row.login_at || "")).getTime();
      const endMs = row.logout_at ? new Date(String(row.logout_at)).getTime() : windowEnd.getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;

      const start = Math.max(startMs, windowStart.getTime());
      const end = Math.min(endMs, windowEnd.getTime());
      if (end <= start) return null;

      return { start, end };
    })
    .filter((x): x is { start: number; end: number } => !!x)
    .sort((a, b) => a.start - b.start);

  let totalMs = 0;
  let currentStart: number | null = null;
  let currentEnd: number | null = null;

  for (const interval of intervals) {
    if (currentStart == null || currentEnd == null) {
      currentStart = interval.start;
      currentEnd = interval.end;
      continue;
    }

    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
      continue;
    }

    totalMs += currentEnd - currentStart;
    currentStart = interval.start;
    currentEnd = interval.end;
  }

  if (currentStart != null && currentEnd != null) {
    totalMs += currentEnd - currentStart;
  }

  return Math.round(totalMs / 60000);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const driverId = (searchParams.get("driver_id") || "").trim();

    if (!driverId) {
      return withNoStore(
        NextResponse.json({ ok: false, error: "driver_id is required" }, { status: 400 })
      );
    }

    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("status", "completed")
      .or(`driver_id.eq.${driverId},assigned_driver_id.eq.${driverId}`)
      .order("updated_at", { ascending: false })
      .limit(500);

    if (error) {
      return withNoStore(
        NextResponse.json({ ok: false, error: "Failed to fetch today stats", detail: error.message }, { status: 500 })
      );
    }

    const now = new Date();
    const todayKey = manilaDateKey(now);
    const dayStart = manilaDayStart(now);
    const weekStart = manilaWeekStart(now);
    const monthStart = manilaMonthStart(now);

    let rideCompleted = 0;
    let takeoutCompleted = 0;

    for (const row of data || []) {
      const at = completedAt(row);
      if (!at) continue;
      if (manilaDateKey(at) !== todayKey) continue;

      if (serviceType(row) === "takeout") takeoutCompleted += 1;
      else rideCompleted += 1;
    }

    const sessionsRes = await supabase
      .from("driver_presence_sessions")
      .select("login_at,logout_at,last_seen_at")
      .eq("driver_id", driverId)
      .gte("login_at", monthStart.toISOString())
      .limit(10000);

    const sessionRows = sessionsRes.error ? [] : sessionsRes.data || [];

    return withNoStore(
      NextResponse.json({
        ok: true,
        driver_id: driverId,
        timezone: "Asia/Manila",
        date: todayKey,
        ride_completed: rideCompleted,
        takeout_completed: takeoutCompleted,
        total_completed: rideCompleted + takeoutCompleted,
        today_online_minutes: mergedOnlineMinutes(sessionRows, dayStart, now),
        week_online_minutes: mergedOnlineMinutes(sessionRows, weekStart, now),
        month_online_minutes: mergedOnlineMinutes(sessionRows, monthStart, now),
        session_source: "driver_presence_sessions_merged_intervals_v1",
        session_error: sessionsRes.error?.message || null,
        source: "bookings_completed_driver_today_v2",
      })
    );
  } catch (e: any) {
    return withNoStore(
      NextResponse.json({ ok: false, error: e?.message ?? "Unexpected error" }, { status: 500 })
    );
  }
}
