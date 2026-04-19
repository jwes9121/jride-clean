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
  if (s0 === "requested" || s0 === "searching") return "searching";
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
  if (!url || !anonKey) throw new Error("Missing Supabase anon client environment variables.");
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
  if (!url || !serviceRole) throw new Error("Missing Supabase service role environment variables.");
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

function deriveStageHints(status: string, fareReady: boolean) {
  const waitingForDriverProposal = !fareReady && (status === "assigned" || status === "accepted");
  return {
    waiting_for_driver_proposal: waitingForDriverProposal,
    fare_ready: fareReady,
    pickup_metrics_ready: !waitingForDriverProposal,
  };
}

async function resolveDriverIdFromBearer(serviceSupabase: any, authUserId: string): Promise<string | null> {
  const directProfile = await serviceSupabase
    .from("driver_profiles")
    .select("driver_id")
    .eq("driver_id", authUserId)
    .limit(1)
    .maybeSingle();

  if (!directProfile.error && directProfile.data?.driver_id) {
    return s(directProfile.data.driver_id);
  }

  const authUser = await serviceSupabase
    .from("auth_users_view")
    .select("email")
    .eq("id", authUserId)
    .limit(1)
    .maybeSingle();

  const email = s((authUser.data as any)?.email);
  if (!email) return null;

  const byEmail = await serviceSupabase
    .from("driver_profiles")
    .select("driver_id")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (!byEmail.error && byEmail.data?.driver_id) {
    return s(byEmail.data.driver_id);
  }

  return null;
}

function isDriverSecretAuthorized(req: NextRequest): boolean {
  const provided = s(req.headers.get("x-jride-driver-secret"));
  const expected = s(process.env.DRIVER_PING_SECRET) ?? s(process.env.NEXT_PUBLIC_DRIVER_PING_SECRET);
  return !!provided && !!expected && provided === expected;
}

export async function GET(req: NextRequest) {
  try {
    const serviceSupabase = createServiceSupabase();
    const accessToken = getBearerToken(req);

    let driverId: string | null = null;
    let authMode: "bearer" | "driver_secret" | null = null;

    if (accessToken) {
      const authSupabase = createAnonSupabase();
      const { data: userRes, error: userErr } = await authSupabase.auth.getUser(accessToken);
      const user = userRes?.user ?? null;
      if (userErr || !user?.id) {
        return NextResponse.json(
          { ok: false, error: "NOT_AUTHED", message: "Invalid bearer token." },
          { status: 401, headers: noStoreHeaders() }
        );
      }
      driverId = await resolveDriverIdFromBearer(serviceSupabase, user.id);
      authMode = "bearer";
    } else if (isDriverSecretAuthorized(req)) {
      driverId = s(req.nextUrl.searchParams.get("driver_id"));
      authMode = "driver_secret";
    } else {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHED", message: "Missing bearer token or valid driver secret." },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    if (!driverId) {
      return NextResponse.json(
        {
          ok: false,
          error: "DRIVER_NOT_FOUND",
          message: authMode === "driver_secret" ? "Missing driver_id query parameter." : "No driver profile found for token user.",
        },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    const bookingRes = await serviceSupabase
      .from("bookings")
      .select("*")
      .or(`driver_id.eq.${driverId},assigned_driver_id.eq.${driverId}`)
      .in("status", ["assigned", "accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (bookingRes.error) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_QUERY_FAILED", details: bookingRes.error.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const booking = bookingRes.data;
    if (!booking) {
      return NextResponse.json(
        { ok: true, trip: null, active_trip: null, auth_mode: authMode },
        { status: 200, headers: noStoreHeaders() }
      );
    }

    let passengerPhone: string | null = null;

    if ((booking as any).created_by_user_id) {
      const passengerProfileRes = await serviceSupabase
        .from("passenger_profiles")
        .select("phone")
        .eq("user_id", (booking as any).created_by_user_id)
        .limit(1)
        .maybeSingle();

      if (!passengerProfileRes.error && passengerProfileRes.data) {
        passengerPhone = s((passengerProfileRes.data as any).phone);
      }
    }

    let driverName: string | null = null;
    let driverPhone: string | null = null;
    let driverLat: number | null = null;
    let driverLng: number | null = null;

    const driverProfileRes = await serviceSupabase
      .from("driver_profiles")
      .select("driver_id, full_name, callsign, phone")
      .eq("driver_id", driverId)
      .limit(1)
      .maybeSingle();

    if (!driverProfileRes.error && driverProfileRes.data) {
      driverName = s((driverProfileRes.data as any).full_name) ?? s((driverProfileRes.data as any).callsign);
      driverPhone = s((driverProfileRes.data as any).phone);
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

    const normalizedStatus = statusOf((booking as any).status);
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
    const submittedRegularFare = n((booking as any).submitted_regular_fare);
    const pickupDistanceFee = n((booking as any).pickup_distance_fee) ?? 0;
    const promoAppliedAmount = n((booking as any).promo_applied_amount) ?? 0;
    const promoStatus = s((booking as any).promo_status);
    const promoProgramCode = s((booking as any).promo_program_code);
    const platformFee = 15;

    const fare = verifiedFare ?? proposedFare;
    const subtotalBeforeDiscount =
      fare == null
        ? null
        : Number((fare + pickupDistanceFee + platformFee).toFixed(2));

    const payableTotal =
      subtotalBeforeDiscount == null
        ? null
        : Number(Math.max(0, subtotalBeforeDiscount - promoAppliedAmount).toFixed(2));

    const hints = deriveStageHints(normalizedStatus, fare != null);

    const trip = {
      id: booking.id,
      booking_id: booking.id,
      booking_code: booking.booking_code,
      code: booking.booking_code,
      status: normalizedStatus,
      town: s((booking as any).town),
      from_label: s((booking as any).from_label),
      to_label: s((booking as any).to_label),
      pickup_lat: pickupLat,
      pickup_lng: pickupLng,
      dropoff_lat: dropoffLat,
      dropoff_lng: dropoffLng,
      passenger_name: s((booking as any).passenger_name),
      passenger_phone: passengerPhone,
      passenger_count: n((booking as any).passenger_count),
      driver_id: s((booking as any).driver_id) ?? driverId,
      assigned_driver_id: s((booking as any).assigned_driver_id) ?? driverId,
      driver_name: driverName,
      driver_phone: driverPhone,
      driver_lat: driverLat,
      driver_lng: driverLng,
      driver_to_pickup_km: driverToPickupKm,
      trip_distance_km: tripDistanceKm,
      pickup_eta_minutes: pickupEtaMinutes,
      eta_minutes: pickupEtaMinutes,
      proposed_fare: proposedFare,
      verified_fare: verifiedFare,
      submitted_regular_fare: submittedRegularFare,
      fare,
      pickup_distance_fee: pickupDistanceFee,
      platform_fee: platformFee,
      promo_applied_amount: promoAppliedAmount,
      promo_status: promoStatus,
      promo_program_code: promoProgramCode,
      subtotal_before_discount: subtotalBeforeDiscount,
      payable_total: payableTotal,
      total_fare: payableTotal,
      total_amount: payableTotal,
      grand_total: payableTotal,
      fare_ready: hints.fare_ready,
      pickup_metrics_ready: hints.pickup_metrics_ready,
      waiting_for_driver_proposal: hints.waiting_for_driver_proposal,
      passenger_fare_response: s((booking as any).passenger_fare_response),
      created_at: s((booking as any).created_at),
      updated_at: s((booking as any).updated_at),
      completed_at: s((booking as any).completed_at),
      cancelled_at: s((booking as any).cancelled_at),
    };

    return NextResponse.json(
      {
        ok: true,
        trip,
        active_trip: trip,
        auth_mode: authMode,
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "ACTIVE_TRIP_ROUTE_CRASH", details: err?.message ?? "UNKNOWN_ERROR" },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
