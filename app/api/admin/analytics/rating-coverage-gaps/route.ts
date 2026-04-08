import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type BookingRow = {
  id: string | null;
  booking_code: string | null;
  town: string | null;
  driver_id: string | null;
  passenger_name: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type RatingRow = {
  booking_id: string | null;
  booking_code: string | null;
};

type DriverProfileRow = {
  driver_id: string | null;
  full_name: string | null;
  municipality: string | null;
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
    const limitRaw = Number(url.searchParams.get("limit") || "20");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 20;

    const [bookingsRes, ratingsRes, profilesRes] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, booking_code, town, driver_id, passenger_name, created_at, updated_at")
        .eq("status", "completed")
        .order("updated_at", { ascending: false })
        .limit(1000),
      supabase
        .from("trip_ratings")
        .select("booking_id, booking_code"),
      supabase
        .from("driver_profiles")
        .select("driver_id, full_name, municipality"),
    ]);

    if (bookingsRes.error) {
      return NextResponse.json(
        { ok: false, error: "RATING_GAPS_BOOKINGS_FAILED", message: bookingsRes.error.message },
        { status: 500 }
      );
    }

    if (ratingsRes.error) {
      return NextResponse.json(
        { ok: false, error: "RATING_GAPS_RATINGS_FAILED", message: ratingsRes.error.message },
        { status: 500 }
      );
    }

    if (profilesRes.error) {
      return NextResponse.json(
        { ok: false, error: "RATING_GAPS_PROFILES_FAILED", message: profilesRes.error.message },
        { status: 500 }
      );
    }

    const bookings = Array.isArray(bookingsRes.data) ? (bookingsRes.data as BookingRow[]) : [];
    const ratings = Array.isArray(ratingsRes.data) ? (ratingsRes.data as RatingRow[]) : [];
    const profiles = Array.isArray(profilesRes.data) ? (profilesRes.data as DriverProfileRow[]) : [];

    const ratedBookingIds = new Set<string>();
    const ratedBookingCodes = new Set<string>();

    for (const r of ratings) {
      const bookingId = String(r.booking_id || "").trim();
      const bookingCode = String(r.booking_code || "").trim();
      if (bookingId) ratedBookingIds.add(bookingId);
      if (bookingCode) ratedBookingCodes.add(bookingCode);
    }

    const profileMap = new Map<string, DriverProfileRow>();
    for (const p of profiles) {
      const driverId = String(p.driver_id || "").trim();
      if (!driverId) continue;
      profileMap.set(driverId, p);
    }

    const missingAllRows = bookings
      .filter((b) => {
        const bookingId = String(b.id || "").trim();
        const bookingCode = String(b.booking_code || "").trim();
        if (bookingId && ratedBookingIds.has(bookingId)) return false;
        if (bookingCode && ratedBookingCodes.has(bookingCode)) return false;
        return true;
      })
      .map((b) => {
        const driverId = String(b.driver_id || "").trim();
        const profile = profileMap.get(driverId);

        return {
          booking_id: b.id,
          booking_code: b.booking_code,
          town: b.town || profile?.municipality || "Unknown",
          driver_id: b.driver_id,
          driver_name: profile?.full_name || "Unknown Driver",
          passenger_name: b.passenger_name || "Unknown Passenger",
          completed_at: b.updated_at || b.created_at,
        };
      });

    const rows = missingAllRows.slice(0, limit);

    const townMap = new Map<string, { completed: number; rated: number; missing: number }>();

    for (const b of bookings) {
      const town = String(b.town || "Unknown");
      const bookingId = String(b.id || "").trim();
      const bookingCode = String(b.booking_code || "").trim();
      const hasRating =
        (bookingId && ratedBookingIds.has(bookingId)) ||
        (bookingCode && ratedBookingCodes.has(bookingCode));

      const prev = townMap.get(town) || { completed: 0, rated: 0, missing: 0 };
      prev.completed += 1;
      if (hasRating) {
        prev.rated += 1;
      } else {
        prev.missing += 1;
      }
      townMap.set(town, prev);
    }

    const summaryByTown = Array.from(townMap.entries())
      .map(([town, v]) => ({
        town,
        completed_trips: v.completed,
        rated_trips: v.rated,
        missing_ratings: v.missing,
        coverage_pct: v.completed > 0 ? v.rated / v.completed : 0,
      }))
      .sort((a, b) => {
        if (b.missing_ratings !== a.missing_ratings) {
          return b.missing_ratings - a.missing_ratings;
        }
        return a.coverage_pct - b.coverage_pct;
      });

    return NextResponse.json({
      ok: true,
      summary: {
        completed_trips: bookings.length,
        rated_trips: bookings.length - missingAllRows.length,
        missing_ratings: missingAllRows.length,
      },
      summary_by_town: summaryByTown,
      rows,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "RATING_GAPS_ROUTE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}