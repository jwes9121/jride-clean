import { NextResponse } from "next/server";
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

const UNCLASSIFIED_TOWN_TOKENS = new Set([
  "",
  "unknown",
  "n/a",
  "na",
  "null",
  "-",
  "none",
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

type ServiceKey = "rides" | "takeout" | "combined";
type PeriodKey = "today" | "week" | "month";

type PeriodMetrics = {
  total_trips: number;
  ride_trips: number;
  takeout_trips: number;
  company_share_total: number;
  toda_share_total: number;
  takeout_service_fee_total: number;
  takeout_total_payable: number;
};

type TownMetrics = {
  town: string;
  total_trips: number;
  ride_trips: number;
  takeout_trips: number;
  company_share_total: number;
  toda_share_total: number;
  toda_completed_trips: number;
  non_toda_completed_trips: number;
  takeout_service_fee_total: number;
  takeout_total_payable: number;
  toda_breakdown: Record<string, { toda_name: string; trips: number; toda_share_total: number }>;
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

function isClassifiedTown(v: unknown): boolean {
  const s = text(v).toLowerCase();
  return !UNCLASSIFIED_TOWN_TOKENS.has(s);
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
    total_trips: 0,
    ride_trips: 0,
    takeout_trips: 0,
    company_share_total: 0,
    toda_share_total: 0,
    takeout_service_fee_total: 0,
    takeout_total_payable: 0,
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
    dateKey: `${String(map.year).padStart(4, "0")}-${String(map.month).padStart(2, "0")}-${String(map.day).padStart(2, "0")}`,
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

function addPeriodMetric(metrics: PeriodMetrics, service: ServiceKey, companyShare: number, todaShare: number, takeoutServiceFee: number, takeoutPayable: number) {
  metrics.total_trips += 1;
  if (service === "takeout") metrics.takeout_trips += 1;
  else metrics.ride_trips += 1;
  metrics.company_share_total += companyShare;
  metrics.toda_share_total += todaShare;
  metrics.takeout_service_fee_total += takeoutServiceFee;
  metrics.takeout_total_payable += takeoutPayable;
}

function addWindowMetrics(
  periods: Record<PeriodKey, PeriodMetrics>,
  at: Date | null,
  service: ServiceKey,
  companyShare: number,
  todaShare: number,
  takeoutServiceFee: number,
  takeoutPayable: number,
) {
  if (!at) return;

  const now = new Date();

  const todayKey = getManilaParts(now).dateKey;
  const weekKey = weekStartDateKey(now);
  const monthKey = monthStartDateKey(now);

  const rowKey = getManilaParts(at).dateKey;

  if (rowKey === todayKey) {
    addPeriodMetric(
      periods.today,
      service,
      companyShare,
      todaShare,
      takeoutServiceFee,
      takeoutPayable,
    );
  }

  if (rowKey >= weekKey) {
    addPeriodMetric(
      periods.week,
      service,
      companyShare,
      todaShare,
      takeoutServiceFee,
      takeoutPayable,
    );
  }

  if (rowKey >= monthKey) {
    addPeriodMetric(
      periods.month,
      service,
      companyShare,
      todaShare,
      takeoutServiceFee,
      takeoutPayable,
    );
  }
}

export async function GET() {
  try {
    const supabase = getSupabase();

    const [bookingsRes, profilesRes] = await Promise.all([
      supabase
        .from("bookings")
        .select("*")
        .eq("status", "completed"),
      supabase
        .from("driver_profiles")
        .select("driver_id, full_name, municipality, is_toda_member, toda_org, toda_share_per_ride"),
    ]);

    if (bookingsRes.error) throw bookingsRes.error;
    if (profilesRes.error) throw profilesRes.error;

    const bookings = Array.isArray(bookingsRes.data) ? (bookingsRes.data as AnyRow[]) : [];
    const profiles = Array.isArray(profilesRes.data) ? (profilesRes.data as DriverProfileRow[]) : [];

    const profileMap = new Map<string, DriverProfileRow>();
    for (const row of profiles) {
      const driverId = text(row.driver_id);
      if (!driverId) continue;
      profileMap.set(driverId, row);
    }

    const townMap = new Map<string, TownMetrics>();
    const periods = blankPeriods();

    const hiddenUnclassified = {
      total_trips: 0,
      ride_trips: 0,
      takeout_trips: 0,
      company_share_total: 0,
      toda_share_total: 0,
      toda_completed_trips: 0,
      takeout_service_fee_total: 0,
      takeout_total_payable: 0,
      periods: blankPeriods(),
    };

    for (const row of bookings) {
      if (isExcludedPassenger(row.passenger_name)) continue;

      const resolvedDriverId = text(row.driver_id) || text(row.assigned_driver_id);
      const profile = resolvedDriverId ? profileMap.get(resolvedDriverId) : undefined;
      if (resolvedDriverId && isTestDriver(resolvedDriverId, profile?.full_name)) continue;

      const kind = serviceType(row);
      const resolvedTownRaw = row.town || row.zone || row.municipality || profile?.municipality;
      const town = normalizeTown(resolvedTownRaw);
      const classifiedTown = isClassifiedTown(resolvedTownRaw);

      const isTodaMember = profile?.is_toda_member === true;
      const todaName = text(profile?.toda_org);
      const todaSharePerRide = numberValue(profile?.toda_share_per_ride) > 0 ? numberValue(profile?.toda_share_per_ride) : 1;
      const normalizedTodaName = String(todaName || "").trim().toUpperCase();
      const isTodaRide =
        kind === "rides" &&
        isTodaMember === true &&
        !!todaName &&
        !["NON_TODA", "NONE", "N/A", "NA", "NULL", "-", "NO TODA"].includes(normalizedTodaName);

      const takeoutServiceFee = kind === "takeout" ? numberValue(row.takeout_service_fee) : 0;
      const takeoutPayable = kind === "takeout" ? numberValue(row.takeout_total_payable) : 0;
      const todaShare = isTodaRide ? todaSharePerRide : 0;
      const companyShare = kind === "takeout"
        ? takeoutServiceFee || 15
        : isTodaRide
          ? Math.max(0, 15 - todaSharePerRide)
          : 15;
      const at = completedAt(row);

      addWindowMetrics(periods, at, kind, companyShare, todaShare, takeoutServiceFee, takeoutPayable);

      if (!classifiedTown) {
        hiddenUnclassified.total_trips += 1;
        if (kind === "takeout") hiddenUnclassified.takeout_trips += 1;
        else hiddenUnclassified.ride_trips += 1;
        hiddenUnclassified.company_share_total += companyShare;
        hiddenUnclassified.toda_share_total += todaShare;
        hiddenUnclassified.takeout_service_fee_total += takeoutServiceFee;
        hiddenUnclassified.takeout_total_payable += takeoutPayable;
        if (isTodaRide) hiddenUnclassified.toda_completed_trips += 1;
        addWindowMetrics(hiddenUnclassified.periods, at, kind, companyShare, todaShare, takeoutServiceFee, takeoutPayable);
        continue;
      }

      const prev = townMap.get(town) || {
        town,
        total_trips: 0,
        ride_trips: 0,
        takeout_trips: 0,
        company_share_total: 0,
        toda_share_total: 0,
        toda_completed_trips: 0,
        non_toda_completed_trips: 0,
        takeout_service_fee_total: 0,
        takeout_total_payable: 0,
        toda_breakdown: {},
        periods: blankPeriods(),
      };

      prev.total_trips += 1;
      if (kind === "takeout") prev.takeout_trips += 1;
      else prev.ride_trips += 1;
      prev.company_share_total += companyShare;
      prev.toda_share_total += todaShare;
      prev.takeout_service_fee_total += takeoutServiceFee;
      prev.takeout_total_payable += takeoutPayable;
      addWindowMetrics(prev.periods, at, kind, companyShare, todaShare, takeoutServiceFee, takeoutPayable);

      if (isTodaRide) {
        prev.toda_completed_trips += 1;
        const todaPrev = prev.toda_breakdown[todaName] || {
          toda_name: todaName,
          trips: 0,
          toda_share_total: 0,
        };
        todaPrev.trips += 1;
        todaPrev.toda_share_total += todaShare;
        prev.toda_breakdown[todaName] = todaPrev;
      } else {
        prev.non_toda_completed_trips += 1;
      }

      townMap.set(town, prev);
    }

    const rows = Array.from(townMap.values())
      .map((row) => ({
        town: row.town,
        total_trips: row.total_trips,
        ride_trips: row.ride_trips,
        takeout_trips: row.takeout_trips,
        total_revenue: row.company_share_total,
        company_share_total: row.company_share_total,
        toda_share_total: row.toda_share_total,
        toda_completed_trips: row.toda_completed_trips,
        non_toda_completed_trips: row.non_toda_completed_trips,
        takeout_service_fee_total: row.takeout_service_fee_total,
        takeout_total_payable: row.takeout_total_payable,
        periods: row.periods,
        toda_breakdown: Object.values(row.toda_breakdown).sort((a, b) => b.trips - a.trips || a.toda_name.localeCompare(b.toda_name, "en")),
      }))
      .sort((a, b) => b.total_trips - a.total_trips || a.town.localeCompare(b.town, "en"));

    const totals = rows.reduce(
      (acc, row) => {
        acc.total_trips += numberValue(row.total_trips);
        acc.ride_trips += numberValue(row.ride_trips);
        acc.takeout_trips += numberValue(row.takeout_trips);
        acc.company_share_total += numberValue(row.company_share_total);
        acc.toda_share_total += numberValue(row.toda_share_total);
        acc.toda_completed_trips += numberValue(row.toda_completed_trips);
        acc.takeout_service_fee_total += numberValue(row.takeout_service_fee_total);
        acc.takeout_total_payable += numberValue(row.takeout_total_payable);
        return acc;
      },
      {
        total_trips: 0,
        ride_trips: 0,
        takeout_trips: 0,
        company_share_total: 0,
        toda_share_total: 0,
        toda_completed_trips: 0,
        takeout_service_fee_total: 0,
        takeout_total_payable: 0,
      }
    );

    return NextResponse.json({
      ok: true,
      rows,
      totals,
      periods,
      hidden_unclassified_legacy: hiddenUnclassified,
      source: {
        mode: "bookings_completed_backcompat_v1",
        service_split: "service_type_or_takeout_fields",
        period_timezone: "Asia/Manila",
        note: "Backward-compatible analytics API. Existing UI fields are preserved; takeout and period fields are additive.",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "TRIPS_ANALYTICS_FAILED" }, { status: 500 });
  }
}
