import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TEST_DRIVER_IDS = new Set([
  "00000000-0000-4000-8000-000000000001",
]);

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizeTown(v: unknown): string {
  const s = text(v);
  return s || "Unknown";
}

function isTestDriver(id: unknown, fullName: unknown): boolean {
  const driverId = text(id);
  const name = text(fullName).toLowerCase();
  if (TEST_DRIVER_IDS.has(driverId)) return true;
  if (!name) return false;
  return name.includes("test driver");
}

type BookingRow = {
  driver_id: string | null;
  assigned_driver_id: string | null;
  town: string | null;
};

type DriverProfileRow = {
  driver_id: string | null;
  full_name: string | null;
  municipality: string | null;
  toda_name: string | null;
};

type RatingRow = {
  driver_id: string | null;
  rating: number | null;
};

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!url) {
    throw new Error("Missing env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!key) {
    throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY");
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") || "10");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 10;

    const [bookingsRes, profilesRes, ratingsRes] = await Promise.all([
      supabase
        .from("bookings")
        .select("driver_id, assigned_driver_id, town")
        .eq("status", "completed"),
      supabase
        .from("driver_profiles")
        .select("driver_id, full_name, municipality, toda_name"),
      supabase
        .from("trip_ratings")
        .select("driver_id, rating"),
    ]);

    if (bookingsRes.error) {
      return NextResponse.json(
        { ok: false, error: "DRIVER_ANALYTICS_BOOKINGS_FAILED", message: bookingsRes.error.message },
        { status: 500 }
      );
    }

    if (profilesRes.error) {
      return NextResponse.json(
        { ok: false, error: "DRIVER_ANALYTICS_PROFILES_FAILED", message: profilesRes.error.message },
        { status: 500 }
      );
    }

    if (ratingsRes.error) {
      return NextResponse.json(
        { ok: false, error: "DRIVER_ANALYTICS_RATINGS_FAILED", message: ratingsRes.error.message },
        { status: 500 }
      );
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
    }>();

    for (const row of bookings) {
      const driverId = text(row.driver_id) || text(row.assigned_driver_id);
      if (!driverId) continue;

      const profile = profileMap.get(driverId);
      const name = text(profile?.full_name) || "Unknown Driver";
      if (isTestDriver(driverId, name)) continue;

      const municipality = normalizeTown(profile?.municipality || row.town);
      const todaName = text(profile?.toda_name) || null;
      const isTodaRide = !!todaName;

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
      };

      prev.completed_trips += 1;
      prev.total_company_share += isTodaRide ? 14 : 15;
      prev.total_toda_share += isTodaRide ? 1 : 0;
      if (isTodaRide) {
        prev.toda_completed_trips += 1;
      } else {
        prev.non_toda_completed_trips += 1;
      }

      aggregate.set(driverId, prev);
    }

    const rows = Array.from(aggregate.values())
      .map((row) => {
        const ratingInfo = ratingMap.get(row.driver_id) || { count: 0, sum: 0 };
        const averageRating = ratingInfo.count > 0 ? ratingInfo.sum / ratingInfo.count : null;

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
          total_platform_revenue: row.total_company_share,
          ratings_count: ratingInfo.count,
          average_rating: averageRating,
        };
      })
      .sort((a, b) => {
        if (b.completed_trips !== a.completed_trips) return b.completed_trips - a.completed_trips;
        return b.total_company_share - a.total_company_share;
      })
      .slice(0, limit);

    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "DRIVER_ANALYTICS_ROUTE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
