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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

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
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

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

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

function estimateEtaMinutes(distanceKm: number | null): number | null {
  if (distanceKm == null || distanceKm <= 0) return null;
  return Math.max(1, Math.ceil((distanceKm / 25) * 60));
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

    const driverId = s((booking as any).driver_id) || s((booking as any).assigned_driver_id);

    let driverName: string | null =
      s((booking as any).driver_name) ||
      s((booking as any).driver_full_name) ||
      null;

    let driverPhone: string | null = s((booking as any).driver_phone) || null;

    let driverLat: number | null = null;
    let driverLng: number | null = null;

    if (driverId) {
      const driverRes = await serviceSupabase
        .from("drivers")
        .select("id, driver_name")
        .eq("id", driverId)
        .limit(1)
        .maybeSingle();

      if (!driverRes.error && driverRes.data) {
        driverName = driverName ?? s((driverRes.data as any).driver_name);
      }

      const driverProfileRes = await serviceSupabase
        .from("driver_profiles")
        .select("driver_id, full_name, callsign, phone")
        .eq("driver_id", driverId)
        .limit(1)
        .maybeSingle();

      if (!driverProfileRes.error && driverProfileRes.data) {
        driverName =
          driverName ??
          s((driverProfileRes.data as any).full_name) ??
          s((driverProfileRes.data as any).callsign);

        driverPhone = driverPhone ?? s((driverProfileRes.data as any).phone);
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

    const pickupLat = n((booking as any).pickup_lat);
    const pickupLng = n((booking as any).pickup_lng);
    const dropoffLat = n((booking as any).dropoff_lat);
    const dropoffLng = n((booking as any).dropoff_lng);

    let driverToPickupKm = n((booking as any).driver_to_pickup_km);
    if (driverToPickupKm == null && driverLat != null && driverLng != null && pickupLat != null && pickupLng != null) {
      driverToPickupKm = Number(haversineKm(driverLat, driverLng, pickupLat, pickupLng).toFixed(1));
    }

    let tripDistanceKm = n((booking as any).trip_distance_km);
    if (tripDistanceKm == null && pickupLat != null && pickupLng != null && dropoffLat != null && dropoffLng != null) {
      tripDistanceKm = Number(haversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng).toFixed(2));
    }

    const pickupEtaMinutes =
      n((booking as any).pickup_eta_minutes) ??
      n((booking as any).eta_minutes) ??
      estimateEtaMinutes(driverToPickupKm);

    const proposedFare = n((booking as any).proposed_fare);
    const verifiedFare = n((booking as any).verified_fare);
    const pickupDistanceFee = n((booking as any).pickup_distance_fee);
    const totalFare =
      n((booking as any).total_fare) ??
      ((proposedFare ?? verifiedFare ?? 0) + (pickupDistanceFee ?? 0));

    return NextResponse.json(
      {
        ok: true,
        id: booking.id,
        booking_code: booking.booking_code,
        status: statusOf((booking as any).status),

        town: s((booking as any).town),
        from_label: s((booking as any).from_label),
        to_label: s((booking as any).to_label),

        pickup_lat: pickupLat,
        pickup_lng: pickupLng,
        dropoff_lat: dropoffLat,
        dropoff_lng: dropoffLng,

        driver_id: s((booking as any).driver_id),
        assigned_driver_id: s((booking as any).assigned_driver_id),
        driver_name: driverName,
        driver_phone: driverPhone,
        driver_lat: driverLat,
        driver_lng: driverLng,

        driver_to_pickup_km: driverToPickupKm,
        trip_distance_km: tripDistanceKm,
        pickup_eta_minutes: pickupEtaMinutes,

        proposed_fare: proposedFare,
        verified_fare: verifiedFare,
        pickup_distance_fee: pickupDistanceFee,
        base_fee: n((booking as any).base_fee),
        distance_fare: n((booking as any).distance_fare),
        total_fare: totalFare,

        fare_ready: proposedFare != null || verifiedFare != null,
        pickup_metrics_ready: driverToPickupKm != null,
        waiting_for_driver_proposal: proposedFare == null && verifiedFare == null,

        passenger_fare_response: s((booking as any).passenger_fare_response),
        created_by_user_id: bookingOwnerId,
        created_at: s((booking as any).created_at),
        updated_at: s((booking as any).updated_at),
        completed_at: s((booking as any).completed_at),
        cancelled_at: s((booking as any).cancelled_at),
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "TRACK_ROUTE_CRASH",
        details: String(e?.message ?? e),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
