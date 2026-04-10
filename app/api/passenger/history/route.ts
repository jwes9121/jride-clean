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

type DriverMap = Record<
  string,
  {
    driver_name: string | null;
    driver_phone: string | null;
  }
>;

function parseLimit(raw: string | null): number {
  const x = Number(raw);
  if (!Number.isFinite(x)) return 50;
  return Math.max(1, Math.min(200, Math.trunc(x)));
}

function parseStatuses(raw: string | null): string[] | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const out = text
    .split(",")
    .map((v) => statusOf(v))
    .filter((v) => v.length > 0);
  return out.length > 0 ? Array.from(new Set(out)) : null;
}

function toHistoryRow(booking: any, driverMap: DriverMap) {
  const driverId = s(booking.driver_id) || s(booking.assigned_driver_id);
  const driverInfo = driverId ? driverMap[driverId] : undefined;

  const driverName =
    s(booking.driver_name) ||
    s(booking.driver_full_name) ||
    driverInfo?.driver_name ||
    null;

  const driverPhone =
    s(booking.driver_phone) ||
    driverInfo?.driver_phone ||
    null;

  const proposedFare = n(booking.proposed_fare);
  const verifiedFare = n(booking.verified_fare);
  const pickupDistanceFee = n(booking.pickup_distance_fee);
  const platformFee = null;

  const totalFare =
    n(booking.total_fare) ??
    n(booking.total_amount) ??
    n(booking.grand_total) ??
    ((proposedFare ?? 0) + (pickupDistanceFee ?? 0));

  return {
    id: booking.id ?? null,
    booking_code: booking.booking_code ?? null,
    status: statusOf(booking.status),

    passenger_name: s(booking.passenger_name),
    driver_id: driverId,
    assigned_driver_id: s(booking.assigned_driver_id),
    driver_name: driverName,
    driver_phone: driverPhone,

    town: s(booking.town),
    from_label: s(booking.from_label) || s(booking.pickup_label),
    to_label: s(booking.to_label) || s(booking.dropoff_label),

    pickup_label: s(booking.pickup_label) || s(booking.from_label),
    dropoff_label: s(booking.dropoff_label) || s(booking.to_label),

    pickup_lat: n(booking.pickup_lat),
    pickup_lng: n(booking.pickup_lng),
    dropoff_lat: n(booking.dropoff_lat),
    dropoff_lng: n(booking.dropoff_lng),

    driver_lat: n(booking.driver_lat),
    driver_lng: n(booking.driver_lng),

    driver_to_pickup_km: n(booking.driver_to_pickup_km),
    pickup_eta_minutes:
      n(booking.pickup_eta_minutes) ??
      n(booking.eta_minutes) ??
      n(booking.eta_pickup_minutes),
    trip_distance_km: n(booking.trip_distance_km),

    proposed_fare: proposedFare,
    verified_fare: verifiedFare,
    pickup_distance_fee: pickupDistanceFee,
    platform_fee: platformFee,
    total_fare: totalFare,
    total_amount: n(booking.total_amount) ?? totalFare,
    grand_total: n(booking.grand_total) ?? totalFare,

    passenger_fare_response: s(booking.passenger_fare_response),

    created_by_user_id: s(booking.created_by_user_id),
    created_at: s(booking.created_at),
    updated_at: s(booking.updated_at),
    completed_at: s(booking.completed_at),
    cancelled_at: s(booking.cancelled_at),
  };
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

    const { data: userRes, error: userErr } =
      await authSupabase.auth.getUser(accessToken);
    const user = userRes?.user ?? null;

    if (userErr || !user?.id) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHED", message: "Invalid bearer token." },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const statusFilter = parseStatuses(url.searchParams.get("status"));

    let query = serviceSupabase
      .from("bookings")
      .select("*")
      .eq("created_by_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (statusFilter && statusFilter.length > 0) {
      query = query.in("status", statusFilter);
    }

    const bookingsRes = await query;

    if (bookingsRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "HISTORY_QUERY_FAILED",
          details: bookingsRes.error.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const bookings = Array.isArray(bookingsRes.data) ? bookingsRes.data : [];

    const driverIds = Array.from(
      new Set(
        bookings
          .map((b: any) => s(b.driver_id) || s(b.assigned_driver_id))
          .filter((v): v is string => Boolean(v))
      )
    );

    let driverMap: DriverMap = {};

    if (driverIds.length > 0) {
      const driversRes = await serviceSupabase
        .from("drivers")
        .select("id, full_name, phone")
        .in("id", driverIds);

      if (!driversRes.error && Array.isArray(driversRes.data)) {
        driverMap = Object.fromEntries(
          driversRes.data.map((row: any) => [
            String(row.id),
            {
              driver_name: s(row.full_name),
              driver_phone: s(row.phone),
            },
          ])
        );
      }
    }

    const trips = bookings.map((booking: any) => toHistoryRow(booking, driverMap));

    return NextResponse.json(
      {
        ok: true,
        passenger_user_id: user.id,
        count: trips.length,
        trips,
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "HISTORY_ROUTE_CRASH",
        details: err?.message ?? "UNKNOWN_ERROR",
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}