import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  noStoreHeaders,
  resolveAuthenticatedDriver,
} from "@/lib/advance-booking/driverAuth";
import {
  DRIVER_DISPATCH_FRESH_SECONDS,
  DRIVER_STANDBY_TTL_SECONDS,
  resolveDriverDispatchLocationCandidate,
} from "@/lib/driver/standbyDispatch";

export const dynamic = "force-dynamic";

const ONLINE_LIKE = new Set(["online", "available", "idle", "waiting"]);
const JRIDE_SERVICE_TOWNS = ["Lagawe", "Lamut", "Banaue", "Hingyon", "Kiangan"] as const;
const ACTIVE_BOOKING_STATUSES = [
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
  "pickup_ready",
];
const ACTIVE_AGRIMARKET_STATUSES = [
  "driver_assigned",
  "picked_up",
  "delivering",
];

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function json(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: noStoreHeaders(),
  });
}

function canonicalServiceTown(value: unknown): string | null {
  const raw = text(value)
    .toLowerCase()
    .replace(/^municipality\s+of\s+/, "")
    .replace(/^city\s+of\s+/, "")
    .trim();
  if (!raw) return null;
  return (
    JRIDE_SERVICE_TOWNS.find((town) => town.toLowerCase() === raw) ?? null
  );
}

function mapboxToken(): string {
  return text(
    process.env.MAPBOX_ACCESS_TOKEN ||
      process.env.MAPBOX_TOKEN ||
      process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  );
}

async function resolveSavedHomeTown(
  lat: number,
  lng: number
): Promise<
  | { ok: true; town: string; rawPlace: string }
  | { ok: false; error: string; message: string }
> {
  const token = mapboxToken();
  if (!token) {
    return {
      ok: false,
      error: "MAPBOX_TOKEN_MISSING",
      message: "Saved Home town could not be verified.",
    };
  }

  try {
    const url =
      "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
      encodeURIComponent(String(lng)) +
      "," +
      encodeURIComponent(String(lat)) +
      ".json?types=place&limit=1&language=en&access_token=" +
      encodeURIComponent(token);

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        ok: false,
        error: "HOME_TOWN_LOOKUP_FAILED",
        message: "Saved Home town verification failed.",
      };
    }

    const payload: any = await response.json().catch(() => ({}));
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const feature =
      features.find(
        (item: any) =>
          Array.isArray(item?.place_type) &&
          item.place_type.includes("place")
      ) ||
      features[0] ||
      null;
    const rawPlace = text(feature?.text) || text(feature?.place_name);
    const town = canonicalServiceTown(rawPlace);

    if (!town) {
      return {
        ok: false,
        error: "HOME_OUTSIDE_SERVICE_TOWN",
        message: "Saved Home is outside a supported JRide service town.",
      };
    }

    return { ok: true, town, rawPlace };
  } catch (error: any) {
    return {
      ok: false,
      error: "HOME_TOWN_LOOKUP_FAILED",
      message: text(error?.message) || "Saved Home town verification failed.",
    };
  }
}

async function authenticatedDriver(req: NextRequest) {
  const auth = await resolveAuthenticatedDriver(req);
  if (!auth.ok) {
    return {
      ok: false as const,
      response: json(
        {
          ok: false,
          error: auth.error,
          message: auth.message,
        },
        auth.status
      ),
    };
  }
  return { ok: true as const, driverId: auth.driverId };
}

async function loadState(admin: any, driverId: string) {
  const [locationRes, homeRes, standbyRes] = await Promise.all([
    admin
      .from("driver_locations")
      .select(
        "driver_id,status,updated_at,lat,lng,town,home_town,vehicle_type"
      )
      .eq("driver_id", driverId)
      .maybeSingle(),
    admin
      .from("driver_home_locations")
      .select(
        "driver_id,home_lat,home_lng,address_hint,set_at,updated_at"
      )
      .eq("driver_id", driverId)
      .maybeSingle(),
    admin
      .from("driver_standby_sessions")
      .select(
        "driver_id,home_lat,home_lng,town,address_hint,confirmed_at,expires_at,consumed_at,consumed_reason,cancelled_at,cancel_reason"
      )
      .eq("driver_id", driverId)
      .maybeSingle(),
  ]);

  return { locationRes, homeRes, standbyRes };
}

async function hasActiveDriverWork(admin: any, driverId: string) {
  const nowIso = new Date().toISOString();
  const [bookingRes, agrimarketRes, offerRes] = await Promise.all([
    admin
      .from("bookings")
      .select("id,booking_code,service_type,status")
      .or(`driver_id.eq.${driverId},assigned_driver_id.eq.${driverId}`)
      .in("status", ACTIVE_BOOKING_STATUSES)
      .limit(1),
    admin
      .from("agrimarket_orders")
      .select("id,order_code,status")
      .eq("assigned_driver_id", driverId)
      .in("status", ACTIVE_AGRIMARKET_STATUSES)
      .limit(1),
    admin
      .from("agrimarket_driver_offers")
      .select("id,order_id,status,expires_at")
      .eq("driver_id", driverId)
      .eq("status", "offered")
      .gt("expires_at", nowIso)
      .limit(1),
  ]);

  const error =
    bookingRes.error || agrimarketRes.error || offerRes.error || null;
  if (error) {
    return {
      ok: false as const,
      active: false,
      message: text(error.message || error),
    };
  }

  return {
    ok: true as const,
    active:
      (bookingRes.data || []).length > 0 ||
      (agrimarketRes.data || []).length > 0 ||
      (offerRes.data || []).length > 0,
  };
}

export async function GET(req: NextRequest) {
  const auth = await authenticatedDriver(req);
  if (!auth.ok) return auth.response;

  const admin = supabaseAdmin();
  const state = await loadState(admin, auth.driverId);
  const error =
    state.locationRes.error || state.homeRes.error || state.standbyRes.error;

  if (error) {
    return json(
      {
        ok: false,
        error: "STANDBY_LOOKUP_FAILED",
        message: text(error.message || error),
      },
      500
    );
  }

  const location = state.locationRes.data || {
    driver_id: auth.driverId,
    lat: null,
    lng: null,
    town: null,
    updated_at: null,
  };
  const resolution = resolveDriverDispatchLocationCandidate(
    location,
    state.standbyRes.data,
    Date.now(),
    DRIVER_DISPATCH_FRESH_SECONDS
  );
  const standbyActive = resolution.ok && resolution.source === "standby";
  const standbyReason = resolution.ok
    ? resolution.source === "standby"
      ? "active"
      : "fresh_live_gps"
    : resolution.reason;

  return json({
    ok: true,
    hasHome: !!state.homeRes.data,
    home: state.homeRes.data
      ? {
          addressHint: state.homeRes.data.address_hint ?? null,
          setAt: state.homeRes.data.set_at ?? null,
          updatedAt: state.homeRes.data.updated_at ?? null,
        }
      : null,
    standby: {
      active: standbyActive,
      confirmedAt: standbyActive ? resolution.standbyConfirmedAt : null,
      expiresAt: standbyActive ? resolution.standbyExpiresAt : null,
      addressHint: standbyActive
        ? state.standbyRes.data?.address_hint ?? null
        : null,
      reason: standbyReason,
    },
    liveGps: {
      fresh: resolution.ok && resolution.source === "live_gps",
      updatedAt: resolution.liveUpdatedAt,
      ageSeconds: resolution.liveAgeSeconds,
    },
  });
}

export async function PUT(req: NextRequest) {
  const auth = await authenticatedDriver(req);
  if (!auth.ok) return auth.response;

  const admin = supabaseAdmin();
  const state = await loadState(admin, auth.driverId);
  const error =
    state.locationRes.error || state.homeRes.error || state.standbyRes.error;

  if (error) {
    return json(
      {
        ok: false,
        error: "STANDBY_PRECHECK_FAILED",
        message: text(error.message || error),
      },
      500
    );
  }

  const location = state.locationRes.data;
  if (!location) {
    return json(
      {
        ok: false,
        error: "DRIVER_LOCATION_STATE_MISSING",
        message: "Go Online before enabling Standby Location.",
      },
      409
    );
  }

  const status = text(location.status).toLowerCase();
  if (!ONLINE_LIKE.has(status)) {
    return json(
      {
        ok: false,
        error: "DRIVER_NOT_ONLINE",
        message: "Standby Location is available only while you are Online.",
      },
      409
    );
  }

  const liveOnly = resolveDriverDispatchLocationCandidate(
    location,
    null,
    Date.now(),
    DRIVER_DISPATCH_FRESH_SECONDS
  );
  if (liveOnly.ok && liveOnly.source === "live_gps") {
    return json(
      {
        ok: false,
        error: "FRESH_GPS_AVAILABLE",
        message: "Live GPS is already fresh. Standby Location is not needed.",
      },
      409
    );
  }

  if (!state.homeRes.data) {
    return json(
      {
        ok: false,
        error: "HOME_LOCATION_NOT_CONFIGURED",
        message:
          "Set your saved Home location first, then confirm Standby Location.",
      },
      409
    );
  }

  const activeWork = await hasActiveDriverWork(admin, auth.driverId);
  if (!activeWork.ok) {
    return json(
      {
        ok: false,
        error: "ACTIVE_WORK_CHECK_FAILED",
        message: activeWork.message,
      },
      503
    );
  }
  if (activeWork.active) {
    return json(
      {
        ok: false,
        error: "ACTIVE_WORK_PRESENT",
        message:
          "Standby Location cannot be enabled while a booking, offer, or trip is active.",
      },
      409
    );
  }

  const driverTown = canonicalServiceTown(
    location.home_town || location.town
  );
  if (!driverTown) {
    return json(
      {
        ok: false,
        error: "DRIVER_TOWN_MISSING",
        message: "Driver town is required before enabling Standby Location.",
      },
      409
    );
  }

  const homeLat = Number(state.homeRes.data.home_lat);
  const homeLng = Number(state.homeRes.data.home_lng);
  if (
    !Number.isFinite(homeLat) ||
    !Number.isFinite(homeLng) ||
    homeLat < -90 ||
    homeLat > 90 ||
    homeLng < -180 ||
    homeLng > 180
  ) {
    return json(
      {
        ok: false,
        error: "INVALID_SAVED_HOME",
        message: "Saved Home coordinates are invalid.",
      },
      409
    );
  }

  let verifiedHomeTown: string | null = null;
  const previousStandby = state.standbyRes.data;
  const previousLat = Number(previousStandby?.home_lat);
  const previousLng = Number(previousStandby?.home_lng);
  const previousTown = canonicalServiceTown(previousStandby?.town);
  const samePreviouslyVerifiedHome =
    Number.isFinite(previousLat) &&
    Number.isFinite(previousLng) &&
    Math.abs(previousLat - homeLat) < 0.0000001 &&
    Math.abs(previousLng - homeLng) < 0.0000001 &&
    previousTown === driverTown;

  if (samePreviouslyVerifiedHome) {
    verifiedHomeTown = previousTown;
  } else {
    const townLookup = await resolveSavedHomeTown(homeLat, homeLng);
    if (!townLookup.ok) {
      const status =
        townLookup.error === "HOME_OUTSIDE_SERVICE_TOWN" ? 409 : 503;
      return json(
        {
          ok: false,
          error: townLookup.error,
          message: townLookup.message,
        },
        status
      );
    }
    verifiedHomeTown = townLookup.town;
  }

  if (verifiedHomeTown !== driverTown) {
    return json(
      {
        ok: false,
        error: "HOME_LOCATION_TOWN_MISMATCH",
        message:
          "Saved Home must be inside your JRide service town before Standby Location can be used.",
        driverTown,
        homeTown: verifiedHomeTown,
      },
      409
    );
  }

  const now = new Date();
  const confirmedAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + DRIVER_STANDBY_TTL_SECONDS * 1000
  ).toISOString();

  const standbyRes = await admin
    .from("driver_standby_sessions")
    .upsert(
      {
        driver_id: auth.driverId,
        home_lat: homeLat,
        home_lng: homeLng,
        town: verifiedHomeTown,
        address_hint: state.homeRes.data.address_hint ?? null,
        confirmed_at: confirmedAt,
        expires_at: expiresAt,
        consumed_at: null,
        consumed_reason: null,
        cancelled_at: null,
        cancel_reason: null,
        updated_at: confirmedAt,
      },
      { onConflict: "driver_id" }
    )
    .select(
      "driver_id,town,address_hint,confirmed_at,expires_at,consumed_at,cancelled_at"
    )
    .single();

  if (standbyRes.error) {
    return json(
      {
        ok: false,
        error: "STANDBY_ENABLE_FAILED",
        message: standbyRes.error.message,
      },
      500
    );
  }

  return json({
    ok: true,
    standby: {
      active: true,
      town: standbyRes.data.town,
      addressHint: standbyRes.data.address_hint ?? null,
      confirmedAt: standbyRes.data.confirmed_at,
      expiresAt: standbyRes.data.expires_at,
      ttlSeconds: DRIVER_STANDBY_TTL_SECONDS,
      dispatchOnly: true,
    },
    message:
      "Standby Location is active for initial dispatch only. It is not live GPS.",
  });
}

export async function DELETE(req: NextRequest) {
  const auth = await authenticatedDriver(req);
  if (!auth.ok) return auth.response;

  const admin = supabaseAdmin();
  const nowIso = new Date().toISOString();
  const result = await admin
    .from("driver_standby_sessions")
    .update({
      cancelled_at: nowIso,
      cancel_reason: "driver_cancelled",
      updated_at: nowIso,
    })
    .eq("driver_id", auth.driverId)
    .is("consumed_at", null)
    .is("cancelled_at", null)
    .select("driver_id")
    .maybeSingle();

  if (result.error) {
    return json(
      {
        ok: false,
        error: "STANDBY_CANCEL_FAILED",
        message: result.error.message,
      },
      500
    );
  }

  return json({
    ok: true,
    cancelled: !!result.data?.driver_id,
  });
}
