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

type SegmentName = "production" | "test" | "legacy";

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

function normalizeText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function isTestPassenger(passengerName: string): boolean {
  const name = normalizeText(passengerName);
  if (!name) return false;
  return name.includes("test") || name === "che er";
}

function isTestDriver(driverName: string): boolean {
  const name = normalizeText(driverName);
  if (!name) return false;
  return name.includes("test driver") || name.includes("driver 000") || name.includes("000");
}

function inferSegment(bookingCreatedAt: string | null, passengerName: string, driverName: string, launchCutoff: number): SegmentName {
  const createdAtMs = bookingCreatedAt ? new Date(bookingCreatedAt).getTime() : NaN;
  const isLegacy = !Number.isFinite(createdAtMs) || createdAtMs < launchCutoff;
  const isTest = isTestPassenger(passengerName) || isTestDriver(driverName) || normalizeText(passengerName) === "unknown passenger";

  if (isLegacy) return "legacy";
  if (isTest) return "test";
  return "production";
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") || "12");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 12;

    const launchDate = String(url.searchParams.get("launch_date") || "2026-04-07T00:00:00+08:00");
    const launchCutoff = new Date(launchDate).getTime();

    const [bookingsRes, ratingsRes, profilesRes] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, booking_code, town, driver_id, passenger_name, created_at, updated_at")
        .eq("status", "completed")
        .order("updated_at", { ascending: false })
        .limit(1500),
      supabase
        .from("trip_ratings")
        .select("booking_id, booking_code, created_at"),
      supabase
        .from("driver_profiles")
        .select("driver_id, full_name"),
    ]);

    if (bookingsRes.error) {
      return NextResponse.json({ ok: false, error: "SEGMENTED_COMPLIANCE_BOOKINGS_FAILED", message: bookingsRes.error.message }, { status: 500 });
    }
    if (ratingsRes.error) {
      return NextResponse.json({ ok: false, error: "SEGMENTED_COMPLIANCE_RATINGS_FAILED", message: ratingsRes.error.message }, { status: 500 });
    }
    if (profilesRes.error) {
      return NextResponse.json({ ok: false, error: "SEGMENTED_COMPLIANCE_PROFILES_FAILED", message: profilesRes.error.message }, { status: 500 });
    }

    const bookings = Array.isArray(bookingsRes.data) ? bookingsRes.data as BookingRow[] : [];
    const ratings = Array.isArray(ratingsRes.data) ? ratingsRes.data as RatingRow[] : [];
    const profiles = Array.isArray(profilesRes.data) ? profilesRes.data as DriverProfileRow[] : [];

    const profileMap = new Map<string, string>();
    for (const p of profiles) {
      const id = String(p.driver_id || "").trim();
      if (!id) continue;
      profileMap.set(id, String(p.full_name || "Unknown Driver"));
    }

    const ratingMap = new Map<string, string>();
    for (const r of ratings) {
      const bookingId = String(r.booking_id || "").trim();
      const bookingCode = String(r.booking_code || "").trim();
      const createdAt = String(r.created_at || "");
      if (bookingId) ratingMap.set(bookingId, createdAt);
      if (bookingCode) ratingMap.set(bookingCode, createdAt);
    }

    const summary = {
      production: { completed: 0, rated: 0, missing: 0 },
      test: { completed: 0, rated: 0, missing: 0 },
      legacy: { completed: 0, rated: 0, missing: 0 },
    };

    const sampleRows: Array<{
      segment: SegmentName;
      booking_code: string | null;
      town: string | null;
      driver_name: string;
      passenger_name: string;
      completed_at: string | null;
      rated_at: string | null;
    }> = [];

    for (const b of bookings) {
      const driverId = String(b.driver_id || "").trim();
      const driverName = profileMap.get(driverId) || "Unknown Driver";
      const passengerName = String(b.passenger_name || "Unknown Passenger");
      const segment = inferSegment(b.created_at, passengerName, driverName, launchCutoff);
      const bookingId = String(b.id || "").trim();
      const bookingCode = String(b.booking_code || "").trim();
      const ratedAt = ratingMap.get(bookingId) || ratingMap.get(bookingCode) || null;

      summary[segment].completed += 1;
      if (ratedAt) {
        summary[segment].rated += 1;
      } else {
        summary[segment].missing += 1;
      }

      if (sampleRows.length < limit) {
        sampleRows.push({
          segment,
          booking_code: b.booking_code,
          town: b.town || "Unknown",
          driver_name: driverName,
          passenger_name: passengerName,
          completed_at: b.updated_at || b.created_at,
          rated_at: ratedAt,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      launch_date: launchDate,
      summary,
      rows: sampleRows,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "SEGMENTED_COMPLIANCE_ROUTE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}