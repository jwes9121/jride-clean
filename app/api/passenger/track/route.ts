import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function statusOf(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "requested" || s === "searching") return "pending";
  if (s === "driver_assigned") return "assigned";
  if (s === "accepted_by_driver") return "accepted";
  if (s === "en_route") return "on_the_way";
  if (s === "in_progress") return "on_trip";
  return s;
}

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function createAnonSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

  if (!url || !anonKey) {
    throw new Error("Missing Supabase anon client environment variables.");
  }

  return createSupabaseClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function createServiceSupabase() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const serviceRole =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";

  if (!url || !serviceRole) {
    throw new Error("Missing Supabase service role environment variables.");
  }

  return createSupabaseClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const bookingCode = searchParams.get("booking_code")?.trim();

    if (!bookingCode) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING_CODE" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const accessToken = getBearerToken(req);
    if (!accessToken) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHED", message: "Missing bearer token." },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    const authSupabase = createAnonSupabase();
    const serviceSupabase = createServiceSupabase();

    const { data: userRes, error: userErr } = await authSupabase.auth.getUser(accessToken);
    const user = userRes?.user ?? null;

    if (userErr || !user?.id) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHED", message: "Invalid bearer token." },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    const bookingRes = await serviceSupabase
      .from("bookings")
      .select("*")
      .eq("booking_code", bookingCode)
      .eq("created_by_user_id", user.id)
      .limit(1);

    if (bookingRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "BOOKING_QUERY_FAILED",
          details: bookingRes.error.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const booking = bookingRes.data?.[0];
    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_NOT_FOUND" },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    const driverId = booking.driver_id ?? booking.assigned_driver_id ?? null;

    let driverName: string | null = null;
    let driverPhone: string | null = null;
    let driverLat: number | null = null;
    let driverLng: number | null = null;

    if (driverId) {
      const driverRes = await serviceSupabase
        .from("drivers")
        .select("id,full_name,phone")
        .eq("id", driverId)
        .limit(1);

      if (!driverRes.error) {
        const driver = driverRes.data?.[0];
        if (driver) {
          driverName = driver.full_name ?? null;
          driverPhone = driver.phone ?? null;
        }
      }

      const driverLocRes = await serviceSupabase
        .from("driver_locations_latest")
        .select("lat,lng")
        .eq("driver_id", driverId)
        .maybeSingle();

      if (!driverLocRes.error && driverLocRes.data) {
        driverLat = n((driverLocRes.data as any).lat);
        driverLng = n((driverLocRes.data as any).lng);
      }
    }

    const proposedFare = n(booking.proposed_fare);
    const pickupDistanceFee = n(booking.pickup_distance_fee);
    const totalFare =
      n((booking as any).total_fare) ??
      ((proposedFare ?? 0) + (pickupDistanceFee ?? 0));

    return NextResponse.json(
      {
        ok: true,
        id: booking.id,
        booking_code: booking.booking_code,
        status: statusOf(booking.status),

        town: booking.town ?? null,
        from_label: booking.from_label ?? null,
        to_label: booking.to_label ?? null,

        pickup_lat: n(booking.pickup_lat),
        pickup_lng: n(booking.pickup_lng),
        dropoff_lat: n(booking.dropoff_lat),
        dropoff_lng: n(booking.dropoff_lng),

        driver_id: booking.driver_id ?? null,
        assigned_driver_id: booking.assigned_driver_id ?? null,
        driver_name: driverName,
        driver_phone: driverPhone,
        driver_lat: driverLat,
        driver_lng: driverLng,

        driver_to_pickup_km: n(booking.driver_to_pickup_km),
        trip_distance_km: n(booking.trip_distance_km),
        pickup_eta_minutes:
          n((booking as any).pickup_eta_minutes) ??
          n((booking as any).eta_minutes),

        proposed_fare: proposedFare,
        pickup_distance_fee: pickupDistanceFee,
        total_fare: totalFare,

        passenger_fare_response: booking.passenger_fare_response ?? null,
        created_at: booking.created_at ?? null,
        updated_at: booking.updated_at ?? null,
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "TRACK_ROUTE_CRASH",
        details: err?.message ?? "UNKNOWN_ERROR",
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}