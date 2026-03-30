import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number | null {
  const s = text(v);
  if (!s || s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return null;
  const n = Number(s);
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

function createAuthClient(token: string) {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
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

function createAdminClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase URL or service role key");
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
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
    };
  }

  const client = createAuthClient(token);
  const { data, error } = await client.auth.getUser();

  if (error || !data?.user?.id) {
    return {
      user: null,
      token,
    };
  }

  return {
    user: data.user,
    token,
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

  let pickupDistanceKm = num(booking.driver_to_pickup_km);
  let tripDistanceKm: number | null = null;
  let etaMinutes: number | null = null;

  if (
    pickupDistanceKm == null &&
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

    const adminClient = createAdminClient();

    const { data: bookingRows, error: bookingError } = await adminClient
      .from("bookings")
      .select("*")
      .eq("booking_code", bookingCode)
      .eq("created_by_user_id", auth.user.id)
      .limit(1);

    if (bookingError) {
      return NextResponse.json(
        { ok: false, error: bookingError.message },
        { status: 500 }
      );
    }

    const booking = bookingRows?.[0] ?? null;

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "Booking not found" },
        { status: 404 }
      );
    }

    const bookingRow = booking as Record<string, unknown>;
    const driverId = firstNonBlank(bookingRow.driver_id, bookingRow.assigned_driver_id);

    let driverName: string | null = null;
    let driverPhone: string | null = null;
    let driverLocation: { lat: number | null; lng: number | null } | null = null;

    if (driverId) {
      const { data: driverProfiles } = await adminClient
        .from("driver_profiles")
        .select("*")
        .eq("driver_id", driverId)
        .limit(1);

      const driverProfile = driverProfiles?.[0] ?? null;

      if (driverProfile) {
        const row = driverProfile as Record<string, unknown>;
        driverName = firstNonBlank(row.full_name, row.callsign);
        driverPhone = firstNonBlank(row.phone);
      }

      const { data: latestLocations } = await adminClient
        .from("driver_locations_latest")
        .select("*")
        .eq("driver_id", driverId)
        .limit(1);

      const latestLocation = latestLocations?.[0] ?? null;

      if (latestLocation) {
        const row = latestLocation as Record<string, unknown>;
        driverLocation = {
          lat: num(row.lat) ?? num(row.latitude),
          lng: num(row.lng) ?? num(row.longitude),
        };
      }
    }

    const route = buildRouteMetrics(bookingRow, driverLocation);

    const status = text(bookingRow.status).toLowerCase();
    const proposedFare = num(bookingRow.proposed_fare);

    let verifiedFare = num(bookingRow.verified_fare);
    if (status === "fare_proposed" && verifiedFare === 0) {
      verifiedFare = null;
    }

    const pickupDistanceFee = num(bookingRow.pickup_distance_fee) ?? 0;

    let totalFareStored = num(bookingRow.total_fare);
    if (status === "fare_proposed" && totalFareStored === 0 && proposedFare != null) {
      totalFareStored = null;
    }

    const fare = verifiedFare ?? proposedFare ?? null;
    const totalFare =
      totalFareStored ??
      (fare != null ? fare + pickupDistanceFee : null);

    return NextResponse.json(
      {
        ok: true,
        id: text(bookingRow.id),
        booking_id: text(bookingRow.id),
        booking_code: text(bookingRow.booking_code),
        status: text(bookingRow.status),
        town: text(bookingRow.town),
        from_label: text(bookingRow.from_label || bookingRow.pickup_label),
        to_label: text(bookingRow.to_label || bookingRow.dropoff_label),
        passenger_name: text(bookingRow.passenger_name),
        passenger_fare_response: text(bookingRow.passenger_fare_response),
        driver: {
          id: driverId,
          name: driverName,
          phone: driverPhone,
        },
        route: {
          distance_km: route.distance_km,
          eta_minutes: route.eta_minutes,
          trip_km: route.trip_km,
        },
        proposed_fare: proposedFare,
        verified_fare: verifiedFare,
        pickup_distance_fee: pickupDistanceFee,
        total_fare: totalFare,
        fare,
        driver_name: driverName,
        driver_phone: driverPhone,
        driver_to_pickup_km: route.distance_km,
        pickup_distance_km: route.distance_km,
        eta_minutes: route.eta_minutes,
        trip_distance_km: route.trip_km,
        updated_at: text(bookingRow.updated_at),
        completed_at: text(bookingRow.completed_at),
        cancelled_at: text(bookingRow.cancelled_at),
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