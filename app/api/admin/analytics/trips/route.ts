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

type BookingRow = {
  town: string | null;
  driver_id: string | null;
  assigned_driver_id: string | null;
  passenger_name: string | null;
};

type DriverProfileRow = {
  driver_id: string | null;
  full_name: string | null;
  municipality: string | null;
  is_toda_member: boolean | null;
  toda_org: string | null;
  toda_share_per_ride: number | null;
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

export async function GET() {
  try {
    const supabase = getSupabase();

    const [bookingsRes, profilesRes] = await Promise.all([
      supabase
        .from("bookings")
        .select("town, driver_id, assigned_driver_id, passenger_name")
        .eq("status", "completed"),
      supabase
        .from("driver_profiles")
        .select("driver_id, full_name, municipality, is_toda_member, toda_org, toda_share_per_ride"),
    ]);

    if (bookingsRes.error) throw bookingsRes.error;
    if (profilesRes.error) throw profilesRes.error;

    const bookings = Array.isArray(bookingsRes.data) ? (bookingsRes.data as BookingRow[]) : [];
    const profiles = Array.isArray(profilesRes.data) ? (profilesRes.data as DriverProfileRow[]) : [];

    const profileMap = new Map<string, DriverProfileRow>();
    for (const row of profiles) {
      const driverId = text(row.driver_id);
      if (!driverId) continue;
      profileMap.set(driverId, row);
    }

    const townMap = new Map<string, {
      town: string;
      total_trips: number;
      company_share_total: number;
      toda_share_total: number;
      toda_completed_trips: number;
      non_toda_completed_trips: number;
      toda_breakdown: Record<string, { toda_name: string; trips: number; toda_share_total: number }>;
    }>();

    const hiddenUnclassified = {
      total_trips: 0,
      company_share_total: 0,
      toda_share_total: 0,
      toda_completed_trips: 0,
    };

    for (const row of bookings) {
      if (isExcludedPassenger(row.passenger_name)) continue;

      const resolvedDriverId = text(row.driver_id) || text(row.assigned_driver_id);
      const profile = resolvedDriverId ? profileMap.get(resolvedDriverId) : undefined;
      if (resolvedDriverId && isTestDriver(resolvedDriverId, profile?.full_name)) continue;

      const resolvedTownRaw = row.town || profile?.municipality;
      const town = normalizeTown(resolvedTownRaw);
      const classifiedTown = isClassifiedTown(resolvedTownRaw);

      const isTodaMember = profile?.is_toda_member === true;
      const todaName = text(profile?.toda_org);
      const todaSharePerRide = Number(profile?.toda_share_per_ride || 0) > 0 ? Number(profile?.toda_share_per_ride) : 1;
      const normalizedTodaName = String(todaName || "").trim().toUpperCase();
      const isTodaRide =
        isTodaMember === true &&
        !!todaName &&
        !["NON_TODA", "NONE", "N/A", "NA", "NULL", "-", "NO TODA"].includes(normalizedTodaName);
      const todaShare = isTodaRide ? todaSharePerRide : 0;
      const companyShare = isTodaRide ? Math.max(0, 15 - todaSharePerRide) : 15;

      if (!classifiedTown) {
        hiddenUnclassified.total_trips += 1;
        hiddenUnclassified.company_share_total += companyShare;
        hiddenUnclassified.toda_share_total += todaShare;
        if (isTodaRide) hiddenUnclassified.toda_completed_trips += 1;
        continue;
      }

      const prev = townMap.get(town) || {
        town,
        total_trips: 0,
        company_share_total: 0,
        toda_share_total: 0,
        toda_completed_trips: 0,
        non_toda_completed_trips: 0,
        toda_breakdown: {},
      };

      prev.total_trips += 1;
      prev.company_share_total += companyShare;
      prev.toda_share_total += todaShare;

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
        total_revenue: row.company_share_total,
        company_share_total: row.company_share_total,
        toda_share_total: row.toda_share_total,
        toda_completed_trips: row.toda_completed_trips,
        non_toda_completed_trips: row.non_toda_completed_trips,
        toda_breakdown: Object.values(row.toda_breakdown).sort((a, b) => b.trips - a.trips || a.toda_name.localeCompare(b.toda_name, "en")),
      }))
      .sort((a, b) => b.total_trips - a.total_trips || a.town.localeCompare(b.town, "en"));

    const totals = rows.reduce(
      (acc, row) => {
        acc.total_trips += Number(row.total_trips || 0);
        acc.company_share_total += Number(row.company_share_total || 0);
        acc.toda_share_total += Number(row.toda_share_total || 0);
        acc.toda_completed_trips += Number(row.toda_completed_trips || 0);
        return acc;
      },
      { total_trips: 0, company_share_total: 0, toda_share_total: 0, toda_completed_trips: 0 }
    );

    return NextResponse.json({
      ok: true,
      rows,
      totals,
      hidden_unclassified_legacy: hiddenUnclassified,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "TRIPS_ANALYTICS_FAILED" }, { status: 500 });
  }
}
