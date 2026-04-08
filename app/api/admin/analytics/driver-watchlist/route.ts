import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DriverProfileRow = {
  driver_id: string | null;
  full_name: string | null;
  municipality: string | null;
};

type RatingRow = {
  driver_id: string | null;
  rating: number | null;
  created_at: string | null;
  feedback: string | null;
};

type BookingRow = {
  driver_id: string | null;
  status: string | null;
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
    const minRatingsRaw = Number(url.searchParams.get("min_ratings") || "1");
    const minRatings = Number.isFinite(minRatingsRaw) ? Math.max(minRatingsRaw, 1) : 1;
    const maxAverageRaw = Number(url.searchParams.get("max_average") || "4");
    const maxAverage = Number.isFinite(maxAverageRaw) ? maxAverageRaw : 4;
    const limitRaw = Number(url.searchParams.get("limit") || "8");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 8;

    const [profilesRes, ratingsRes, bookingsRes] = await Promise.all([
      supabase.from("driver_profiles").select("driver_id, full_name, municipality"),
      supabase.from("trip_ratings").select("driver_id, rating, created_at, feedback"),
      supabase.from("bookings").select("driver_id, status").eq("status", "completed"),
    ]);

    if (profilesRes.error) {
      return NextResponse.json(
        { ok: false, error: "WATCHLIST_PROFILES_FAILED", message: profilesRes.error.message },
        { status: 500 }
      );
    }

    if (ratingsRes.error) {
      return NextResponse.json(
        { ok: false, error: "WATCHLIST_RATINGS_FAILED", message: ratingsRes.error.message },
        { status: 500 }
      );
    }

    if (bookingsRes.error) {
      return NextResponse.json(
        { ok: false, error: "WATCHLIST_BOOKINGS_FAILED", message: bookingsRes.error.message },
        { status: 500 }
      );
    }

    const profiles = Array.isArray(profilesRes.data) ? (profilesRes.data as DriverProfileRow[]) : [];
    const ratings = Array.isArray(ratingsRes.data) ? (ratingsRes.data as RatingRow[]) : [];
    const bookings = Array.isArray(bookingsRes.data) ? (bookingsRes.data as BookingRow[]) : [];

    const profileMap = new Map<string, DriverProfileRow>();
    for (const p of profiles) {
      const id = String(p.driver_id || "").trim();
      if (!id) continue;
      profileMap.set(id, p);
    }

    const completedMap = new Map<string, number>();
    for (const b of bookings) {
      const id = String(b.driver_id || "").trim();
      if (!id) continue;
      completedMap.set(id, Number(completedMap.get(id) || 0) + 1);
    }

    const ratingMap = new Map<string, {
      ratings_count: number;
      rating_sum: number;
      low_ratings_count: number;
      latest_feedback: string | null;
      latest_rating_at: string | null;
    }>();

    for (const r of ratings) {
      const id = String(r.driver_id || "").trim();
      if (!id) continue;
      const rating = Number(r.rating || 0);
      if (!Number.isFinite(rating) || rating <= 0) continue;

      const prev = ratingMap.get(id) || {
        ratings_count: 0,
        rating_sum: 0,
        low_ratings_count: 0,
        latest_feedback: null,
        latest_rating_at: null,
      };

      prev.ratings_count += 1;
      prev.rating_sum += rating;
      if (rating <= 3) {
        prev.low_ratings_count += 1;
      }

      const createdAt = String(r.created_at || "");
      if (!prev.latest_rating_at || createdAt > prev.latest_rating_at) {
        prev.latest_rating_at = createdAt || null;
        prev.latest_feedback = String(r.feedback || "").trim() || null;
      }

      ratingMap.set(id, prev);
    }

    const rows = Array.from(ratingMap.entries())
      .map(([driverId, info]) => {
        const average_rating = info.ratings_count > 0 ? info.rating_sum / info.ratings_count : null;
        const profile = profileMap.get(driverId);

        return {
          driver_id: driverId,
          driver_name: String(profile?.full_name || "Unknown Driver"),
          municipality: String(profile?.municipality || "Unknown"),
          completed_trips: Number(completedMap.get(driverId) || 0),
          ratings_count: info.ratings_count,
          average_rating,
          low_ratings_count: info.low_ratings_count,
          latest_feedback: info.latest_feedback,
          latest_rating_at: info.latest_rating_at,
        };
      })
      .filter((row) => row.ratings_count >= minRatings)
      .filter((row) => row.average_rating != null && row.average_rating <= maxAverage)
      .sort((a, b) => {
        if ((a.average_rating || 0) !== (b.average_rating || 0)) {
          return (a.average_rating || 0) - (b.average_rating || 0);
        }
        if (b.low_ratings_count !== a.low_ratings_count) {
          return b.low_ratings_count - a.low_ratings_count;
        }
        return b.ratings_count - a.ratings_count;
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
        error: "WATCHLIST_ROUTE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}