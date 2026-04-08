import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type BookingRow = {
  driver_id: string | null;
  town: string | null;
  driver_payout: number | null;
  company_cut: number | null;
};

type DriverProfileRow = {
  driver_id: string | null;
  full_name: string | null;
  municipality: string | null;
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
        .select("driver_id, town, driver_payout, company_cut")
        .eq("status", "completed"),
      supabase
        .from("driver_profiles")
        .select("driver_id, full_name, municipality"),
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
      const driverId = String(row.driver_id || "").trim();
      if (!driverId) continue;
      profileMap.set(driverId, row);
    }

    const ratingMap = new Map<string, { count: number; sum: number }>();
    for (const row of ratings) {
      const driverId = String(row.driver_id || "").trim();
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
      completed_trips: number;
      total_driver_payout: number;
      total_platform_revenue: number;
    }>();

    for (const row of bookings) {
      const driverId = String(row.driver_id || "").trim();
      if (!driverId) continue;

      const profile = profileMap.get(driverId);
      const name = String(profile?.full_name || "Unknown Driver");
      const municipality = String(profile?.municipality || row.town || "Unknown");

      const prev = aggregate.get(driverId) || {
        driver_id: driverId,
        driver_name: name,
        municipality,
        completed_trips: 0,
        total_driver_payout: 0,
        total_platform_revenue: 0,
      };

      prev.completed_trips += 1;
      prev.total_driver_payout += Number(row.driver_payout || 0);
      prev.total_platform_revenue += Number(row.company_cut || 0);

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
          completed_trips: row.completed_trips,
          total_driver_payout: row.total_driver_payout,
          total_platform_revenue: row.total_platform_revenue,
          ratings_count: ratingInfo.count,
          average_rating: averageRating,
        };
      })
      .sort((a, b) => {
        if (b.completed_trips - a.completed_trips !== 0) {
          return b.completed_trips - a.completed_trips;
        }
        return b.total_platform_revenue - a.total_platform_revenue;
      })
      .slice(0, limit);

    return NextResponse.json({
      ok: true,
      rows,
    });
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