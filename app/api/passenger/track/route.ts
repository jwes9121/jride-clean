import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
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

function firstNonBlank(...values: unknown[]): string | null {
  for (const value of values) {
    const s = text(value);
    if (s) return s;
  }
  return null;
}

function createBearerClient(token: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase URL or anon key");
  }

  return createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function getAuthenticatedUser(req: Request) {
  const token = getBearerToken(req);

  if (!token) {
    return {
      user: null,
      token: null as string | null,
      auth_source: "none" as const,
    };
  }

  const client = createBearerClient(token);
  const { data, error } = await client.auth.getUser();

  if (error || !data?.user?.id) {
    return {
      user: null,
      token,
      auth_source: "none" as const,
    };
  }

  return {
    user: data.user,
    token,
    auth_source: "bearer" as const,
  };
}

function buildRouteMetrics(
  booking: Record<string, unknown>,
  driverLocation: { lat: number | null; lng: number | null } | null
) {
  const pickupLat = num(booking.pickup_lat);
  const pickupLng = num(booking.pickup_lng);
  const dropoffLat = num(booking.dropoff_lat);
  const dropoffLng = num(booking.dropoff_lng);

  let pickupDistanceKm: number | null = null;
  let tripDistanceKm: number | null = null;
  let etaMinutes: number | null = null;

  if (
    driverLocation?.lat != null &&
    driverLocation?.lng != null &&
    pickupLat != null &&
    pickupLng != null
  ) {
    pickupDistanceKm = Number(
      haversineKm(driverLocation.lat, driverLocation.lng, pickupLat, pickupLng).toFixed(1)
    );
  }

  if (
    pickupLat != null &&
    pickupLng != null &&
    dropoffLat != null &&
    dropoffLng != null
  ) {
    tripDistanceKm = Number(
      haversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng).toFixed(1)
    );
  }

  if (pickupDistanceKm != null && pickupDistanceKm > 0) {
    etaMinutes = Math.ceil((pickupDistanceKm / 20) * 60);
  }

  return {
    distance_km: pickupDistanceKm,
    eta_minutes: etaMinutes,
    trip_km: tripDistanceKm,
  };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const bookingCode = text(url.searchParams.get("booking_code"));

    if (!bookingCode) {
      return NextResponse.json(
        { ok: false, error: "booking_code is required" },
        { status: 400 }
      );
    }

    const auth = await getAuthenticatedUser(req);

    if (!auth.user?.id || !auth.token) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const dbClient = createBearerClient(auth.token);

    const { data: booking, error: bookingError } = await dbClient
      .from("bookings")
      .select(
        [
          "id",
          "booking_code",
          "status",
          "town",
          "from_label",
          "to_label",
          "pickup_lat",
          "pickup_lng",
          "dropoff_lat",
          "dropoff_lng",
          "created_at",
          "updated_at",
          "assigned_driver_id",
          "driver_id",
          "proposed_fare",
          "verified_fare",
          "passenger_fare_response",
          "driver_status",
          "customer_status",
          "created_by_user_id",
        ].join(",")
      )
      .eq("booking_code", bookingCode)
      .eq("created_by_user_id", auth.user.id)
      .maybeSingle();

    if (bookingError) {
      return NextResponse.json(
        { ok: false, error: bookingError.message },
        { status: 500 }
      );
    }

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "Booking not found" },
        { status: 404 }
      );
    }

    const bookingRow = booking as unknown as Record<string, unknown>;
    const driverId = firstNonBlank(bookingRow.driver_id, bookingRow.assigned_driver_id);

    let driverName: string | null = null;
    let driverPhone: string | null = null;
    let driverLocation: { lat: number | null; lng: number | null } | null = null;

    if (driverId) {
      const { data: driverProfile } = await dbClient
        .from("driver_profiles")
        .select("driver_id, full_name, callsign, phone")
        .eq("driver_id", driverId)
        .maybeSingle();

      if (driverProfile) {
        const row = driverProfile as unknown as Record<string, unknown>;
        driverName = firstNonBlank(row.full_name, row.callsign);
        driverPhone = firstNonBlank(row.phone);
      }

      const { data: latestLocation } = await dbClient
        .from("driver_locations_latest")
        .select("latitude, longitude, updated_at")
        .eq("driver_id", driverId)
        .maybeSingle();

      if (latestLocation) {
        const row = latestLocation as unknown as Record<string, unknown>;
        driverLocation = {
          lat: num(row.latitude),
          lng: num(row.longitude),
        };
      }
    }

    const route = buildRouteMetrics(bookingRow, driverLocation);
    const fare = num(bookingRow.verified_fare) ?? num(bookingRow.proposed_fare) ?? 0;

    return NextResponse.json(
      {
        ok: true,
        booking_code: text(bookingRow.booking_code),
        status: text(bookingRow.status),
        driver: {
          id: driverId,
          name: driverName,
          phone: driverPhone,
        },
        route: {
          distance_km: route.distance_km ?? 0,
          eta_minutes: route.eta_minutes ?? 0,
          trip_km: route.trip_km ?? 0,
        },
        proposed_fare: num(bookingRow.proposed_fare),
        verified_fare: num(bookingRow.verified_fare),
        fare,
        driver_name: driverName,
        driver_phone: driverPhone,
        pickup_distance_km: route.distance_km ?? 0,
        eta_minutes: route.eta_minutes ?? 0,
        trip_distance_km: route.trip_km ?? 0,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}