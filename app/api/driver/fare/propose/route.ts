import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type ProposeBody = {
  booking_code?: string;
  bookingCode?: string;
  booking_id?: string;
  bookingId?: string;
  proposed_fare?: number | string | null;
  fare?: number | string | null;
  driver_id?: string;
  driverId?: string;
  user_id?: string;
  userId?: string;
};

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "null") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function pickupDistanceFee(km: number): number {
  const freeKm = 1.5;
  const blockKm = 0.5;
  const feePerBlock = 20;

  const chargeableKm = Math.max(0, km - freeKm);
  if (chargeableKm <= 0) return 0;

  const blocks = Math.ceil(chargeableKm / blockKm);
  return blocks * feePerBlock;
}

function estimateEtaMinutes(distanceKm: number | null): number | null {
  if (distanceKm == null || distanceKm <= 0) return null;
  return Math.max(1, Math.ceil((distanceKm / 25) * 60));
}

type NightRateDetails = {
  basis: "booking_created_at" | "server_now";
  basisIso: string;
  manilaHour: number;
  mode: "regular" | "double" | "plus_100";
  adjustedBaseFare: number;
};

type DirectionsResult = {
  distanceKm: number;
  durationMinutes: number | null;
};

function getNightRateDetails(regularFare: number, bookingCreatedAt: unknown): NightRateDetails {
  const createdAtText = text(bookingCreatedAt);
  let basis: NightRateDetails["basis"] = "server_now";
  let basisDate = new Date();

  if (createdAtText) {
    const parsed = new Date(createdAtText);
    if (Number.isFinite(parsed.getTime())) {
      basisDate = parsed;
      basis = "booking_created_at";
    }
  }

  const hourText = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    hour12: false,
  }).format(basisDate);

  const manilaHour = Number(hourText);
  let mode: NightRateDetails["mode"] = "regular";
  let adjustedBaseFare = regularFare;

  if (manilaHour >= 20 && manilaHour <= 22) {
    mode = "double";
    adjustedBaseFare = regularFare * 2;
  } else if (manilaHour >= 23 || manilaHour <= 4) {
    mode = "plus_100";
    adjustedBaseFare = regularFare + 100;
  }

  return {
    basis,
    basisIso: basisDate.toISOString(),
    manilaHour,
    mode,
    adjustedBaseFare,
  };
}

function getMapboxToken(): string {
  const candidates = [
    process.env.MAPBOX_ACCESS_TOKEN,
    process.env.MAPBOX_TOKEN,
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  ];

  for (const v of candidates) {
    const s = text(v);
    if (s) return s;
  }

  return "";
}

async function getRoadDistance(
  fromLng: number,
  fromLat: number,
  toLng: number,
  toLat: number
): Promise<DirectionsResult> {
  const token = getMapboxToken();
  if (!token) {
    throw new Error("ROAD_DISTANCE_TOKEN_MISSING");
  }

  const url =
    "https://api.mapbox.com/directions/v5/mapbox/driving/" +
    `${fromLng},${fromLat};${toLng},${toLat}` +
    `?alternatives=false&geometries=geojson&overview=full&steps=false&access_token=${encodeURIComponent(token)}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`ROAD_DISTANCE_FETCH_FAILED_${res.status}`);
  }

  const json: any = await res.json().catch(() => ({}));
  const route = Array.isArray(json?.routes) ? json.routes[0] : null;
  const meters = Number(route?.distance ?? NaN);
  const seconds = Number(route?.duration ?? NaN);

  if (!Number.isFinite(meters) || meters <= 0) {
    throw new Error("ROAD_DISTANCE_NOT_AVAILABLE");
  }

  return {
    distanceKm: Number((meters / 1000).toFixed(2)),
    durationMinutes:
      Number.isFinite(seconds) && seconds > 0
        ? Math.max(1, Math.ceil(seconds / 60))
        : null,
  };
}

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const body = (await req.json().catch(() => ({}))) as ProposeBody;

    const bookingCode = text(body.booking_code || body.bookingCode);
    const bookingId = text(body.booking_id || body.bookingId);
    const submittedRegularFare = num(body.proposed_fare ?? body.fare);

    if (!bookingCode && !bookingId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING_CODE" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    if (submittedRegularFare == null || submittedRegularFare <= 0) {
      return NextResponse.json(
        { ok: false, error: "INVALID_PROPOSED_FARE" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    let effectiveDriverId = text(
      body.driver_id || body.driverId || body.user_id || body.userId
    );

    if (!effectiveDriverId) {
      const { data: userRes } = await supabase.auth.getUser();
      if (userRes?.user?.id) {
        effectiveDriverId = userRes.user.id;
      }
    }

    if (!effectiveDriverId) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHED", message: "Missing driver identity." },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    let query = supabase.from("bookings").select("*").limit(1);

    if (bookingCode) {
      query = query.eq("booking_code", bookingCode);
    } else {
      query = query.eq("id", bookingId);
    }

    const { data: rows, error: bookingErr } = await query;

    if (bookingErr) {
      return NextResponse.json(
        {
          ok: false,
          error: "BOOKING_READ_FAILED",
          message: bookingErr.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const booking = rows?.[0] ?? null;

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_NOT_FOUND" },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    const assignedDriverId = text((booking as any).assigned_driver_id);
    const bookingDriverId = text((booking as any).driver_id);

    if (
      effectiveDriverId !== assignedDriverId &&
      effectiveDriverId !== bookingDriverId
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "DRIVER_NOT_ASSIGNED",
          assigned_driver_id: assignedDriverId || null,
          driver_id: bookingDriverId || null,
          effective_driver_id: effectiveDriverId || null,
        },
        { status: 403, headers: noStoreHeaders() }
      );
    }

    const currentStatus = text((booking as any).status).toLowerCase();
    if (!["assigned", "accepted"].includes(currentStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_STATUS",
          message: "Fare can only be proposed from assigned or accepted state.",
          status: currentStatus,
        },
        { status: 409, headers: noStoreHeaders() }
      );
    }

    const pickupLat = Number((booking as any).pickup_lat ?? NaN);
    const pickupLng = Number((booking as any).pickup_lng ?? NaN);
    const dropoffLat = Number((booking as any).dropoff_lat ?? NaN);
    const dropoffLng = Number((booking as any).dropoff_lng ?? NaN);

    if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
      return NextResponse.json(
        { ok: false, error: "MISSING_PICKUP_COORDS" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    if (!Number.isFinite(dropoffLat) || !Number.isFinite(dropoffLng)) {
      return NextResponse.json(
        { ok: false, error: "MISSING_DROPOFF_COORDS" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    let driverLat: number | null = null;
    let driverLng: number | null = null;

    const { data: driverLoc } = await supabase
      .from("driver_locations_latest")
      .select("lat,lng")
      .eq("driver_id", effectiveDriverId)
      .maybeSingle();

    if (driverLoc) {
      const lat = Number((driverLoc as any).lat ?? NaN);
      const lng = Number((driverLoc as any).lng ?? NaN);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        driverLat = lat;
        driverLng = lng;
      }
    }

    let driverToPickupKm: number | null = null;
    let pickupEtaMinutes: number | null = null;
    let pickupFee = 0;

    if (driverLat != null && driverLng != null) {
      try {
        const road = await getRoadDistance(driverLng, driverLat, pickupLng, pickupLat);
        driverToPickupKm = road.distanceKm;
        pickupEtaMinutes = road.durationMinutes ?? estimateEtaMinutes(road.distanceKm);
        pickupFee = pickupDistanceFee(road.distanceKm);
      } catch (e: any) {
        return NextResponse.json(
          {
            ok: false,
            error: "ROAD_DISTANCE_UNAVAILABLE",
            message: String(e?.message ?? e),
            stage: "driver_to_pickup",
          },
          { status: 500, headers: noStoreHeaders() }
        );
      }
    }

    let tripDistanceKm: number | null = null;
    try {
      const roadTrip = await getRoadDistance(pickupLng, pickupLat, dropoffLng, dropoffLat);
      tripDistanceKm = roadTrip.distanceKm;
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          error: "ROAD_DISTANCE_UNAVAILABLE",
          message: String(e?.message ?? e),
          stage: "pickup_to_dropoff",
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const nightRate = getNightRateDetails(submittedRegularFare, (booking as any).created_at);
    const adjustedProposedFare = nightRate.adjustedBaseFare;
    const platformFee = 15;
    const totalFare = adjustedProposedFare + pickupFee + platformFee;

    const updatePayload: Record<string, unknown> = {
      proposed_fare: adjustedProposedFare,
      submitted_regular_fare: submittedRegularFare,
      night_rate_hour_ph: nightRate.manilaHour,
      night_rate_mode: nightRate.mode,
      verified_fare: null,
      passenger_fare_response: null,
      driver_to_pickup_km: driverToPickupKm,
      pickup_distance_fee: pickupFee,
      trip_distance_km: tripDistanceKm,
      status: "fare_proposed",
      assigned_driver_id: assignedDriverId || effectiveDriverId,
      driver_id: bookingDriverId || effectiveDriverId,
    };

    const { error: updateErr } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", (booking as any).id);

    if (updateErr) {
      console.error("[FARE_PROPOSE_UPDATE_FAILED]", {
        booking_id: (booking as any).id,
        booking_code: (booking as any).booking_code,
        current_status: currentStatus,
        effective_driver_id: effectiveDriverId,
        assigned_driver_id: assignedDriverId || null,
        booking_driver_id: bookingDriverId || null,
        update_payload: updatePayload,
        update_error: updateErr,
      });

      return NextResponse.json(
        {
          ok: false,
          error: "FARE_PROPOSE_UPDATE_FAILED",
          message: updateErr.message,
          code: (updateErr as any)?.code ?? null,
          details: (updateErr as any)?.details ?? null,
          hint: (updateErr as any)?.hint ?? null,
          current_status: currentStatus,
          booking_code: (booking as any).booking_code ?? null,
          effective_driver_id: effectiveDriverId || null,
          assigned_driver_id: assignedDriverId || null,
          booking_driver_id: bookingDriverId || null,
          update_payload: updatePayload,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const { data: freshRows, error: freshErr } = await supabase
      .from("bookings")
      .select(
        "id, booking_code, status, proposed_fare, verified_fare, passenger_fare_response, driver_to_pickup_km, pickup_distance_fee, trip_distance_km"
      )
      .eq("id", (booking as any).id)
      .limit(1);

    const fresh = freshRows?.[0] ?? null;

    if (freshErr || !fresh) {
      return NextResponse.json(
        {
          ok: true,
          booking_code: (booking as any).booking_code,
          booking_id: (booking as any).id,
          status: "fare_proposed",
          submitted_regular_fare: submittedRegularFare,
          night_rate_basis: nightRate.basis,
          night_rate_basis_iso: nightRate.basisIso,
          night_rate_hour_ph: nightRate.manilaHour,
          night_rate_mode: nightRate.mode,
          proposed_fare: adjustedProposedFare,
          verified_fare: null,
          passenger_fare_response: null,
          driver_to_pickup_km: driverToPickupKm,
          pickup_eta_minutes: pickupEtaMinutes,
          pickup_distance_fee: pickupFee,
          trip_distance_km: tripDistanceKm,
          platform_fee: platformFee,
          total_fare: totalFare,
          reread_warning: freshErr?.message || "REREAD_NOT_AVAILABLE",
        },
        { status: 200, headers: noStoreHeaders() }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        booking_code: (fresh as any).booking_code,
        booking_id: (fresh as any).id,
        status: (fresh as any).status,
        submitted_regular_fare: submittedRegularFare,
        night_rate_basis: nightRate.basis,
        night_rate_basis_iso: nightRate.basisIso,
        night_rate_hour_ph: nightRate.manilaHour,
        night_rate_mode: nightRate.mode,
        proposed_fare: num((fresh as any).proposed_fare),
        verified_fare: num((fresh as any).verified_fare),
        passenger_fare_response: text((fresh as any).passenger_fare_response) || null,
        driver_to_pickup_km: num((fresh as any).driver_to_pickup_km),
        pickup_eta_minutes: pickupEtaMinutes,
        pickup_distance_fee: num((fresh as any).pickup_distance_fee) ?? 0,
        trip_distance_km: num((fresh as any).trip_distance_km),
        platform_fee: platformFee,
        total_fare:
          (num((fresh as any).proposed_fare) ?? 0) +
          (num((fresh as any).pickup_distance_fee) ?? 0) +
          platformFee,
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: String(e?.message ?? e),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
