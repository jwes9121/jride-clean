import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RatingRow = {
  id: string | null;
  booking_id: string | null;
  booking_code: string | null;
  rating: number | null;
  feedback: string | null;
  created_at: string | null;
  driver_id: string | null;
  passenger_id: string | null;
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

    const limitRaw = Number(url.searchParams.get("limit") || "50");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

    const ratingRaw = String(url.searchParams.get("rating") || "").trim();

    let query = supabase
      .from("trip_ratings")
      .select("id, booking_id, booking_code, rating, feedback, created_at, driver_id, passenger_id")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (ratingRaw) {
      const rating = Number(ratingRaw);
      if (Number.isFinite(rating)) {
        query = query.eq("rating", rating);
      }
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "ADMIN_RATINGS_QUERY_FAILED",
          message: error.message,
        },
        { status: 500 }
      );
    }

    const rows = Array.isArray(data) ? (data as RatingRow[]) : [];
    const totalRatings = rows.length;
    const averageRating =
      totalRatings > 0
        ? rows.reduce((sum, row) => sum + Number(row.rating || 0), 0) / totalRatings
        : 0;

    const withFeedback = rows.filter((row) => String(row.feedback || "").trim().length > 0).length;
    const stars5 = rows.filter((row) => Number(row.rating || 0) === 5).length;
    const stars4 = rows.filter((row) => Number(row.rating || 0) === 4).length;
    const stars3 = rows.filter((row) => Number(row.rating || 0) === 3).length;
    const stars2 = rows.filter((row) => Number(row.rating || 0) === 2).length;
    const stars1 = rows.filter((row) => Number(row.rating || 0) === 1).length;

    return NextResponse.json({
      ok: true,
      stats: {
        total_ratings: totalRatings,
        average_rating: averageRating,
        with_feedback: withFeedback,
        stars_5: stars5,
        stars_4: stars4,
        stars_3: stars3,
        stars_2: stars2,
        stars_1: stars1,
        five_star_share: totalRatings > 0 ? stars5 / totalRatings : null,
      },
      rows,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "ADMIN_RATINGS_ROUTE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}