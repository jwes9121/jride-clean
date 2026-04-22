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

type BookingRow = {
  driver_id: string | null;
  assigned_driver_id: string | null;
  town: string | null;
  passenger_name: string | null;
  proposed_fare: number | null;
};

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

function isExcludedPassenger(name: unknown): boolean {
  const s = text(name).toLowerCase();
  return !!s && EXCLUDED_PASSENGER_NAMES.has(s);
}

function isTestDriver(driverId: string, fullName?: string | null): boolean {
  if (TEST_DRIVER_IDS.has(driverId)) return true;
  const s = text(fullName).toLowerCase();
  return s === "test driver" || s.includes("test driver");
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
        .select("driver_id, assigned_driver_id, town, passenger_name, proposed_fare")
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

    const bookings = Array.isArray(bookingsRes.data) ? (bookingsRes.data as BookingRow[]) : [];
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
      const rating = Number(row.rating || 0);
      const prev = ratingMap.get(driverId) || { count: 0, sum: 0 };
      if (Number.isFinite(rating) && rating > 0) {
        prev.count += 1;
        prev.sum += rating;
      }
      ratingMap.set(driverId, prev);
    }

    const aggregate = new Map<string, {
      driver_id: string;
      driver_name: string;
      municipality: string;
      toda_name: string | null;
      completed_trips: number;
      toda_completed_trips: number;
      non_toda_completed_trips: number;
      total_toda_share: number;
      total_company_share: number;
      total_platform_revenue: number;
      gross_proposed_fare_earnings: number;
    }>();

    for (const row of bookings) {
      if (isExcludedPassenger(row.passenger_name)) continue;

      const driverId = text(row.driver_id) || text(row.assigned_driver_id);
      if (!driverId) continue;

      const profile = profileMap.get(driverId);
      const name = text(profile?.full_name) || "Unknown Driver";
      if (isTestDriver(driverId, name)) continue;

      const municipality = normalizeTown(profile?.municipality || row.town);
      const isTodaMember = profile?.is_toda_member === true;
      const todaName = text(profile?.toda_org) || null;
      const todaSharePerRide = Number(profile?.toda_share_per_ride || 0) > 0 ? Number(profile?.toda_share_per_ride) : 1;
      const isTodaRide = isTodaMember && !!todaName;
      const companyShare = isTodaRide ? Math.max(0, 15 - todaSharePerRide) : 15;
      const todaShare = isTodaRide ? todaSharePerRide : 0;
      const proposedFare = Number(row.proposed_fare || 0);

      const prev = aggregate.get(driverId) || {
        driver_id: driverId,
        driver_name: name,
        municipality,
        toda_name: todaName,
        completed_trips: 0,
        toda_completed_trips: 0,
        non_toda_completed_trips: 0,
        total_toda_share: 0,
        total_company_share: 0,
        total_platform_revenue: 0,
        gross_proposed_fare_earnings: 0,
      };

      prev.completed_trips += 1;
      prev.gross_proposed_fare_earnings += proposedFare;
      prev.total_company_share += companyShare;
      prev.total_toda_share += todaShare;
      prev.total_platform_revenue = prev.total_company_share;
      if (isTodaRide) prev.toda_completed_trips += 1;
      else prev.non_toda_completed_trips += 1;

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
          toda_completed_trips: row.toda_completed_trips,
          non_toda_completed_trips: row.non_toda_completed_trips,
          total_toda_share: row.total_toda_share,
          total_company_share: row.total_company_share,
          total_platform_revenue: row.total_platform_revenue,
          gross_proposed_fare_earnings: row.gross_proposed_fare_earnings,
          average_rating: averageRating,
          ratings_count: ratingAgg.count,
        };
      })
      .sort((a, b) => b.gross_proposed_fare_earnings - a.gross_proposed_fare_earnings || b.completed_trips - a.completed_trips || a.driver_name.localeCompare(b.driver_name, "en"))
      .slice(0, limit);

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "DRIVER_ANALYTICS_FAILED" }, { status: 500 });
  }
}
