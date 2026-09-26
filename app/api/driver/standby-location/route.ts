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
      reason: standbyActive
        ? "active"
        : resolution.ok && resolution.source === "live_gps"
          ? "fresh_live_gps"
          : resolution.reason,
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

  const town = text(location.town || location.home_town);
  if (!town) {
    return json(
      {
        ok: false,
        error: "DRIVER_TOWN_MISSING",
        message: "Driver town is required before enabling Standby Location.",
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
        home_lat: state.homeRes.data.home_lat,
        home_lng: state.homeRes.data.home_lng,
        town,
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
