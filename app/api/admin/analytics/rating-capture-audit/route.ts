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
  created_at: string | null;
};

type DriverProfileRow = {
  driver_id: string | null;
  full_name: string | null;
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
        .select("booking_id, booking_code, created_at"),
      supabase
        .from("driver_profiles")
        .select("driver_id, full_name"),
    ]);

    if (bookingsRes.error) {
      return NextResponse.json({ ok: false, error: bookingsRes.error.message }, { status: 500 });
    }
    if (ratingsRes.error) {
      return NextResponse.json({ ok: false, error: ratingsRes.error.message }, { status: 500 });
    }
    if (profilesRes.error) {
      return NextResponse.json({ ok: false, error: profilesRes.error.message }, { status: 500 });
    }

    const bookings = bookingsRes.data || [];
    const ratings = ratingsRes.data || [];
    const profiles = profilesRes.data || [];

    const profileMap = new Map();
    for (const p of profiles) {
      const id = String(p.driver_id || "").trim();
      if (id) profileMap.set(id, p.full_name || "Unknown Driver");
    }

    const ratingMap = new Map();
    for (const r of ratings) {
      const id = String(r.booking_id || r.booking_code || "").trim();
      if (id) ratingMap.set(id, r.created_at);
    }

    const rows = bookings.map((b) => {
      const key = String(b.id || b.booking_code || "").trim();
      const ratedAt = ratingMap.get(key) || null;

      return {
        booking_code: b.booking_code,
        town: b.town || "Unknown",
        driver_name: profileMap.get(String(b.driver_id || "").trim()) || "Unknown Driver",
        passenger_name: b.passenger_name || "Unknown Passenger",
        completed_at: b.updated_at || b.created_at,
        rated_at: ratedAt,
        rating_delay_minutes: ratedAt
          ? Math.floor((new Date(ratedAt).getTime() - new Date(b.updated_at || b.created_at).getTime()) / 60000)
          : null,
      };
    }).slice(0, limit);

    const stats = {
      total_completed: bookings.length,
      total_rated: ratings.length,
      missing: bookings.length - ratings.length,
    };

    return NextResponse.json({
      ok: true,
      stats,
      rows,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}