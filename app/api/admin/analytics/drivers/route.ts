import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TEST_DRIVER_IDS = new Set([
  "00000000-0000-4000-8000-000000000001",
]);

const EXCLUDED_PASSENGER_NAMES = new Set([
  "che er",
  "je wes",
]);

const TAKEOUT_ACTIVE_STATUSES = new Set([
  "vendor_pending",
  "vendor_accepted",
  "driver_assigned",
  "driver_fee_proposed",
  "customer_confirmed",
  "rider_arrived_vendor",
  "picked_up",
  "delivering",
]);

type AnyRow = Record<string, any>;

type DriverProfileRow = {
  driver_id: string | null;
  full_name: string | null;
  municipality: string | null;
  is_toda_member: boolean | null;
  toda_org: string | null;
  toda_share_per_ride: number | null;
};

type RatingRow = {
  driver_id: string | null;
  rating: number | null;
};

type ServiceKey = "rides" | "takeout";
type PeriodKey = "today" | "week" | "month";

type PeriodMetrics = {
  completed_trips: number;
  ride_completed_trips: number;
  takeout_completed_trips: number;
  total_company_share: number;
  total_toda_share: number;
  gross_proposed_fare_earnings: number;
  takeout_delivery_fee_total: number;
  takeout_service_fee_total: number;
};

type DriverMetrics = {
  driver_id: string;
  driver_name: string;
  municipality: string;
  toda_name: string | null;
  completed_trips: number;
  ride_completed_trips: number;
  takeout_completed_trips: number;
  toda_completed_trips: number;
  non_toda_completed_trips: number;
  total_toda_share: number;
  total_company_share: number;
  total_platform_revenue: number;
  gross_proposed_fare_earnings: number;
  takeout_delivery_fee_total: number;
  takeout_service_fee_total: number;
  periods: Record<PeriodKey, PeriodMetrics>;
};

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url) throw new Error("Missing env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function numberValue(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTown(v: unknown): string {
  const s = text(v);
  return s || "Unknown";
}

function isExcludedPassenger(name: unknown): boolean {
  const s = text(name).toLowerCase();
  return !!s && EXCLUDED_PASSENGER_NAMES.has(s);
}

function isTestDriver(driverId: string, fullName?: string | null): boolean {
  if (TEST_DRIVER_IDS.has(driverId)) return true;
  const s = text(fullName).toLowerCase();
  return s === "test driver" || s.includes("test driver");
}

function blankPeriod(): PeriodMetrics {
  return {
    completed_trips: 0,
    ride_completed_trips: 0,
    takeout_completed_trips: 0,
    total_company_share: 0,
    total_toda_share: 0,
    gross_proposed_fare_earnings: 0,
    takeout_delivery_fee_total: 0,
    takeout_service_fee_total: 0,
  };
}

function blankPeriods(): Record<PeriodKey, PeriodMetrics> {
  return {
    today: blankPeriod(),
    week: blankPeriod(),
    month: blankPeriod(),
  };
}

function getManilaParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(d);

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: map.weekday || "",
    dateKey: `${map.year}-${map.month}-${map.day}`,
  };
}

function weekStartDateKey(now = new Date()): string {
  const parts = getManilaParts(now);
  const weekdayIndex: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const idx = weekdayIndex[parts.weekday] ?? 0;
  const mondayOffset = idx === 0 ? -6 : 1 - idx;
  const approx = new Date(now.getTime() + mondayOffset * 24 * 60 * 60 * 1000);
  return getManilaParts(approx).dateKey;
}

function monthStartDateKey(now = new Date()): string {
  const parts = getManilaParts(now);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-01`;
}

function isSameOrAfterDateKey(value: string, start: string): boolean {
  return value >= start;
}

function completedAt(row: AnyRow): Date | null {
  const raw = row.completed_at || row.completedAt || row.dropoff_at || row.updated_at || row.created_at;
  if (!raw) return null;
  const d = new Date(String(raw));
  return Number.isFinite(d.getTime()) ? d : null;
}

function serviceType(row: AnyRow): ServiceKey {
  const explicit = text(row.service_type || row.serviceType || row.trip_type || row.tripType).toLowerCase();
  const status = text(row.status).toLowerCase();
  if (explicit.includes("takeout") || explicit.includes("food")) return "takeout";
  if (TAKEOUT_ACTIVE_STATUSES.has(status)) return "takeout";
  if (
    row.takeout_total_payable != null ||
    row.takeout_service_fee != null ||
    row.takeout_delivery_fee != null ||
    row.vendor_status != null ||
    row.customer_status != null
  ) {
    return "takeout";
  }
  return "rides";
}

function addPeriodMetric(metrics: PeriodMetrics, service: ServiceKey, companyShare: number, todaShare: number, proposedFare: number, takeoutDeliveryFee: number, takeoutServiceFee: number) {
  metrics.completed_trips += 1;
  if (service === "takeout") metrics.takeout_completed_trips += 1;
  else metrics.ride_completed_trips += 1;
  metrics.total_company_share += companyShare;
  metrics.total_toda_share += todaShare;
  metrics.gross_proposed_fare_earnings += proposedFare;
  metrics.takeout_delivery_fee_total += takeoutDeliveryFee;
  metrics.takeout_service_fee_total += takeoutServiceFee;
}

function addWindowMetrics(periods: Record<PeriodKey, PeriodMetrics>, at: Date | null, service: ServiceKey, companyShare: number, todaShare: number, proposedFare: number, takeoutDeliveryFee: number, takeoutServiceFee: number) {
  if (!at) return;
  const now = new Date();
  const todayKey = getManilaParts(now).dateKey;
  const weekKey = weekStartDateKey(now);
  const monthKey = monthStartDateKey(now);
  const rowKey = getManilaParts(at).dateKey;

  if (rowKey === todayKey) addPeriodMetric(periods.today, service, companyShare, todaShare, proposedFare, takeoutDeliveryFee, takeoutServiceFee);
  if (isSameOrAfterDateKey(rowKey, weekKey)) addPeriodMetric(periods.week, service, companyShare, todaShare, proposedFare, takeoutDeliveryFee, takeoutServiceFee);
  if (isSameOrAfterDateKey(rowKey, monthKey)) addPeriodMetric(periods.month, service, companyShare, todaShare, proposedFare, takeoutDeliveryFee, takeoutServiceFee);
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") || "12");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 12;

    const [bookingsRes, profilesRes, ratingsRes] = await Promise.all([
      supabase
        .from("bookings")
        .select("*")
        .eq("status", "completed"),
      supabase
        .from("driver_profiles")
        .select("driver_id, full_name, municipality, is_toda_member, toda_org, toda_share_per_ride"),
      supabase
        .from("trip_ratings")
        .select("driver_id, rating"),
    ]);

    if (bookingsRes.error) {
      return NextResponse.json({ ok: false, error: "DRIVER_ANALYTICS_BOOKINGS_FAILED", message: bookingsRes.error.message }, { status: 500 });
    }
    if (profilesRes.error) {
      return NextResponse.json({ ok: false, error: "DRIVER_ANALYTICS_PROFILES_FAILED", message: profilesRes.error.message }, { status: 500 });
    }
    if (ratingsRes.error) {
      return NextResponse.json({ ok: false, error: "DRIVER_ANALYTICS_RATINGS_FAILED", message: ratingsRes.error.message }, { status: 500 });
    }

    const bookings = Array.isArray(bookingsRes.data) ? (bookingsRes.data as AnyRow[]) : [];
    const profiles = Array.isArray(profilesRes.data) ? (profilesRes.data as DriverProfileRow[]) : [];
    const ratings = Array.isArray(ratingsRes.data) ? (ratingsRes.data as RatingRow[]) : [];

    const profileMap = new Map<string, DriverProfileRow>();
    for (const row of profiles) {
      const driverId = text(row.driver_id);
      if (!driverId) continue;
      profileMap.set(driverId, row);
    }

    const ratingMap = new Map<string, { count: number; sum: number }>();
    for (const row of ratings) {
      const driverId = text(row.driver_id);
      if (!driverId) continue;
      const rating = numberValue(row.rating);
      const prev = ratingMap.get(driverId) || { count: 0, sum: 0 };
      if (rating > 0) {
        prev.count += 1;
        prev.sum += rating;
      }
      ratingMap.set(driverId, prev);
    }

    const aggregate = new Map<string, DriverMetrics>();
    const totals = {
      completed_trips: 0,
      ride_completed_trips: 0,
      takeout_completed_trips: 0,
      total_company_share: 0,
      total_toda_share: 0,
      gross_proposed_fare_earnings: 0,
      takeout_delivery_fee_total: 0,
      takeout_service_fee_total: 0,
    };
    const periods = blankPeriods();

    for (const row of bookings) {
      if (isExcludedPassenger(row.passenger_name)) continue;

      const driverId = text(row.driver_id) || text(row.assigned_driver_id);
      if (!driverId) continue;

      const profile = profileMap.get(driverId);
      const name = text(profile?.full_name) || text(row.driver_name) || "Unknown Driver";
      if (isTestDriver(driverId, name)) continue;

      const kind = serviceType(row);
      const municipality = normalizeTown(profile?.municipality || row.town || row.zone || row.municipality);
      const isTodaMember = profile?.is_toda_member === true;
      const todaName = text(profile?.toda_org) || null;
      const todaSharePerRide = numberValue(profile?.toda_share_per_ride) > 0 ? numberValue(profile?.toda_share_per_ride) : 1;
      const normalizedTodaName = String(todaName || "").trim().toUpperCase();
      const isTodaRide =
        kind === "rides" &&
        isTodaMember === true &&
        !!todaName &&
        !["NON_TODA", "NONE", "N/A", "NA", "NULL", "-", "NO TODA"].includes(normalizedTodaName);

      const proposedFare = kind === "takeout"
        ? numberValue(row.takeout_delivery_fee)
        : numberValue(row.proposed_fare || row.verified_fare || row.base_fare);
      const takeoutDeliveryFee = kind === "takeout" ? numberValue(row.takeout_delivery_fee) : 0;
      const takeoutServiceFee = kind === "takeout" ? numberValue(row.takeout_service_fee) : 0;
      const companyShare = kind === "takeout"
        ? takeoutServiceFee || 15
        : isTodaRide
          ? Math.max(0, 15 - todaSharePerRide)
          : 15;
      const todaShare = isTodaRide ? todaSharePerRide : 0;
      const at = completedAt(row);

      const prev = aggregate.get(driverId) || {
        driver_id: driverId,
        driver_name: name,
        municipality,
        toda_name: todaName,
        completed_trips: 0,
        ride_completed_trips: 0,
        takeout_completed_trips: 0,
        toda_completed_trips: 0,
        non_toda_completed_trips: 0,
        total_toda_share: 0,
        total_company_share: 0,
        total_platform_revenue: 0,
        gross_proposed_fare_earnings: 0,
        takeout_delivery_fee_total: 0,
        takeout_service_fee_total: 0,
        periods: blankPeriods(),
      };

      prev.completed_trips += 1;
      if (kind === "takeout") prev.takeout_completed_trips += 1;
      else prev.ride_completed_trips += 1;
      prev.gross_proposed_fare_earnings += proposedFare;
      prev.takeout_delivery_fee_total += takeoutDeliveryFee;
      prev.takeout_service_fee_total += takeoutServiceFee;
      prev.total_company_share += companyShare;
      prev.total_toda_share += todaShare;
      prev.total_platform_revenue = prev.total_company_share;
      if (isTodaRide) prev.toda_completed_trips += 1;
      else prev.non_toda_completed_trips += 1;
      addWindowMetrics(prev.periods, at, kind, companyShare, todaShare, proposedFare, takeoutDeliveryFee, takeoutServiceFee);

      totals.completed_trips += 1;
      if (kind === "takeout") totals.takeout_completed_trips += 1;
      else totals.ride_completed_trips += 1;
      totals.total_company_share += companyShare;
      totals.total_toda_share += todaShare;
      totals.gross_proposed_fare_earnings += proposedFare;
      totals.takeout_delivery_fee_total += takeoutDeliveryFee;
      totals.takeout_service_fee_total += takeoutServiceFee;
      addWindowMetrics(periods, at, kind, companyShare, todaShare, proposedFare, takeoutDeliveryFee, takeoutServiceFee);

      aggregate.set(driverId, prev);
    }

    const rows = Array.from(aggregate.values())
      .map((row) => {
        const ratingAgg = ratingMap.get(row.driver_id) || { count: 0, sum: 0 };
        const averageRating = ratingAgg.count > 0 ? ratingAgg.sum / ratingAgg.count : 0;
        return {
          driver_id: row.driver_id,
          driver_name: row.driver_name,
          municipality: row.municipality,
          toda_name: row.toda_name,
          completed_trips: row.completed_trips,
          ride_completed_trips: row.ride_completed_trips,
          takeout_completed_trips: row.takeout_completed_trips,
          toda_completed_trips: row.toda_completed_trips,
          non_toda_completed_trips: row.non_toda_completed_trips,
          total_toda_share: row.total_toda_share,
          total_company_share: row.total_company_share,
          total_platform_revenue: row.total_platform_revenue,
          gross_proposed_fare_earnings: row.gross_proposed_fare_earnings,
          takeout_delivery_fee_total: row.takeout_delivery_fee_total,
          takeout_service_fee_total: row.takeout_service_fee_total,
          periods: row.periods,
          average_rating: averageRating,
          ratings_count: ratingAgg.count,
        };
      })
      .sort((a, b) => b.gross_proposed_fare_earnings - a.gross_proposed_fare_earnings || b.completed_trips - a.completed_trips || a.driver_name.localeCompare(b.driver_name, "en"))
      .slice(0, limit);

    return NextResponse.json({
      ok: true,
      rows,
      totals,
      periods,
      source: {
        mode: "bookings_completed_driver_backcompat_v1",
        service_split: "service_type_or_takeout_fields",
        period_timezone: "Asia/Manila",
        note: "Backward-compatible analytics API. Existing UI fields are preserved; ride/takeout and today/week/month fields are additive.",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "DRIVER_ANALYTICS_FAILED" }, { status: 500 });
  }
}
