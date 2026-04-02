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

async function resolveDriverIds(serviceSupabase: any, user: any): Promise<string[]> {
  const ids = new Set<string>();
  const authUserId = s(user?.id);
  const email = s(user?.email);

  if (authUserId) ids.add(authUserId);

  if (email) {
    const profileRes = await serviceSupabase
      .from("driver_profiles")
      .select("driver_id")
      .eq("email", email)
      .limit(10);

    if (!profileRes.error) {
      for (const row of profileRes.data || []) {
        const driverId = s((row as any).driver_id);
        if (driverId) ids.add(driverId);
      }
    }
  }

  return Array.from(ids);
}

async function enrichDriverIdentity(serviceSupabase: any, driverId: string | null) {
  let driverName: string | null = null;
  let driverPhone: string | null = null;
  let driverLat: number | null = null;
  let driverLng: number | null = null;

  if (!driverId) {
    return { driverName, driverPhone, driverLat, driverLng };
  }

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

  return { driverName, driverPhone, driverLat, driverLng };
}

export async function GET(req: NextRequest) {
  try {
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

    const candidateDriverIds = await resolveDriverIds(serviceSupabase, user);
    if (candidateDriverIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "DRIVER_ID_NOT_RESOLVED" },
        { status: 403, headers: noStoreHeaders() }
      );
    }

    const activeStatuses = [
      "assigned",
      "accepted",
      "fare_proposed",
      "ready",
      "on_the_way",
      "arrived",
      "on_trip",
    ];

    const bookingRes = await serviceSupabase
      .from("bookings")
      .select("*")
      .in("status", activeStatuses)
      .or(`driver_id.in.(${candidateDriverIds.join(",")}),assigned_driver_id.in.(${candidateDriverIds.join(",")})`)
      .order("updated_at", { ascending: false })
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
        { ok: true, active_trip: null },
        { status: 200, headers: noStoreHeaders() }
      );
    }

    const driverId = s((booking as any).driver_id) || s((booking as any).assigned_driver_id);
    const identity = await enrichDriverIdentity(serviceSupabase, driverId);

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
        active_trip: {
          id: (booking as any).id,
          booking_code: (booking as any).booking_code,
          status: statusOf((booking as any).status),
          town: s((booking as any).town),
          from_label: s((booking as any).from_label),
          to_label: s((booking as any).to_label),
          pickup_lat: n((booking as any).pickup_lat),
          pickup_lng: n((booking as any).pickup_lng),
          dropoff_lat: n((booking as any).dropoff_lat),
          dropoff_lng: n((booking as any).dropoff_lng),
          passenger_name: s((booking as any).passenger_name),
          driver_id: driverId,
          assigned_driver_id: s((booking as any).assigned_driver_id),
          driver_name: identity.driverName,
          driver_phone: identity.driverPhone,
          driver_lat: identity.driverLat,
          driver_lng: identity.driverLng,
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
          passenger_fare_response: s((booking as any).passenger_fare_response),
          created_by_user_id: s((booking as any).created_by_user_id),
          created_at: s((booking as any).created_at),
          updated_at: s((booking as any).updated_at),
          completed_at: s((booking as any).completed_at),
          cancelled_at: s((booking as any).cancelled_at),
        },
        resolved_driver_ids: candidateDriverIds,
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ACTIVE_TRIP_ROUTE_CRASH",
        details: err?.message ?? "UNKNOWN_ERROR",
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
