import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function s(v: unknown): string | null {
  const x = String(v ?? "").trim();
  return x.length > 0 ? x : null;
}

function statusOf(raw: unknown): string {
  const s0 = String(raw ?? "").trim().toLowerCase();
  if (s0 === "requested" || s0 === "searching") return "pending";
  if (s0 === "driver_assigned") return "assigned";
  if (s0 === "accepted_by_driver") return "accepted";
  if (s0 === "en_route") return "on_the_way";
  if (s0 === "in_progress") return "on_trip";
  return s0;
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

    const { data: userRes, error: userErr } =
      await authSupabase.auth.getUser(accessToken);
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
      .limit(1)
      .maybeSingle();

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

    const booking = bookingRes.data;
    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_NOT_FOUND" },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    const bookingOwnerId = s((booking as any).created_by_user_id);
    if (!bookingOwnerId || bookingOwnerId !== user.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "NOT_BOOKING_OWNER",
          message: "This booking does not belong to the authenticated passenger.",
        },
        { status: 403, headers: noStoreHeaders() }
      );
    }

    const driverId = booking.driver_id ?? booking.assigned_driver_id ?? null;

    let driverName: string | null =
      s((booking as any).driver_name) ||
      s((booking as any).driver_full_name) ||
      null;
    let driverPhone: string | null =
      s((booking as any).driver_phone) || null;
    let driverLat: number | null = null;
    let driverLng: number | null = null;

    if (driverId) {
      const driverRes = await serviceSupabase
        .from("drivers")
        .select("id, full_name, phone")
        .eq("id", driverId)
        .limit(1)
        .maybeSingle();

      if (!driverRes.error && driverRes.data) {
        driverName = driverName ?? s(driverRes.data.full_name);
        driverPhone = driverPhone ?? s(driverRes.data.phone);
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

    const proposedFare = n((booking as any).proposed_fare);
    const verifiedFare = n((booking as any).verified_fare);
    const pickupDistanceFee = n((booking as any).pickup_distance_fee);
    const platformFee = n((booking as any).platform_fee);
    const totalFare =
      n((booking as any).total_fare) ??
      n((booking as any).total_amount) ??
      n((booking as any).grand_total) ??
      ((proposedFare ?? 0) + (pickupDistanceFee ?? 0) + (platformFee ?? 0));

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

        driver_to_pickup_km: n((booking as any).driver_to_pickup_km),
        trip_distance_km: n((booking as any).trip_distance_km),
        pickup_eta_minutes:
          n((booking as any).pickup_eta_minutes) ??
          n((booking as any).eta_minutes),

        proposed_fare: proposedFare,
        verified_fare: verifiedFare,
        pickup_distance_fee: pickupDistanceFee,
        platform_fee: platformFee,
        total_fare: totalFare,
        total_amount: n((booking as any).total_amount) ?? totalFare,
        grand_total: n((booking as any).grand_total) ?? totalFare,

        passenger_fare_response: booking.passenger_fare_response ?? null,
        created_by_user_id: bookingOwnerId,
        created_at: booking.created_at ?? null,
        updated_at: booking.updated_at ?? null,
        completed_at: (booking as any).completed_at ?? null,
        cancelled_at: (booking as any).cancelled_at ?? null,
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