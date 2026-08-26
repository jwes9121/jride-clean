import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import {
  errandFeatureEnabled,
  errandFareBreakdown,
  errandPabiliAccounting,
  loadErrandBundleByBookingId,
} from "@/lib/errand/server";

const ACTIVE_STATUSES = [
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
];

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function secondsUntil(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.ceil((parsed - Date.now()) / 1000));
}

export async function GET(req: Request) {
  try {
    if (!errandFeatureEnabled()) {
      return NextResponse.json(
        { ok: false, error: "ERRAND_BOOKING_NOT_ENABLED" },
        { status: 503, headers: noStoreHeaders() }
      );
    }

    const url = new URL(req.url);
    const identity = await resolveDriverRequest(
      req,
      text(url.searchParams.get("driver_id"))
    );

    if (!identity.ok || !identity.driverId) {
      return NextResponse.json(
        { ok: false, error: identity.error || "NOT_AUTHED" },
        { status: identity.status || 401, headers: noStoreHeaders() }
      );
    }

    const admin = supabaseAdmin();
    const driverId = identity.driverId;

    const { data, error } = await admin
      .from("bookings")
      .select(
        "id,booking_code,status,updated_at,assigned_at,driver_accept_expires_at,driver_to_pickup_km,pickup_distance_fee"
      )
      .eq("service_type", "errand")
      .or(`assigned_driver_id.eq.${driverId},driver_id.eq.${driverId}`)
      .in("status", ACTIVE_STATUSES)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "ERRAND_CURRENT_READ_FAILED", message: error.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const [profileRes, locationRes] = await Promise.all([
      admin
        .from("driver_profiles")
        .select("driver_id,full_name,callsign,municipality,vehicle_type,plate_number,phone,photo_url")
        .eq("driver_id", driverId)
        .maybeSingle(),
      admin
        .from("driver_locations")
        .select("driver_id,lat,lng,status,town,home_town,vehicle_type,updated_at")
        .eq("driver_id", driverId)
        .maybeSingle(),
    ]);

    const driver = !profileRes.error && profileRes.data ? profileRes.data : null;
    const driverLocation = !locationRes.error && locationRes.data ? locationRes.data : null;

    if (!data?.id) {
      return NextResponse.json(
        {
          ok: true,
          errand: null,
          driver,
          driver_location: driverLocation,
          auth_mode: identity.authMode,
        },
        { status: 200, headers: noStoreHeaders() }
      );
    }

    const bundle = await loadErrandBundleByBookingId(text(data.id));
    if (!bundle.ok) {
      return NextResponse.json(
        { ok: false, error: bundle.error },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const mergedBooking = {
      ...(bundle.booking as any),
      ...(data as any),
    };
    const expiresAt = text((data as any).driver_accept_expires_at);
    const fare = errandFareBreakdown(
      mergedBooking,
      bundle.job,
      bundle.settings
    );

    // Keep the Android contract explicit. These aliases are the live values,
    // including the running waiting fee, not the pre-wait stored booking total.
    const driverFare = {
      ...fare,
      current_service_fare: fare.total_errand_fare,
      pickup_distance_surcharge: fare.pickup_distance_fee,
      route_distance_fare: fare.distance_fare,
    };

    return NextResponse.json(
      {
        ok: true,
        auth_mode: identity.authMode,
        driver,
        driver_location: driverLocation,
        offer: {
          active: text((data as any).status).toLowerCase() === "assigned",
          assigned_at: (data as any).assigned_at || null,
          expires_at: expiresAt || null,
          seconds_remaining: secondsUntil(expiresAt),
          pickup_road_distance_km: (data as any).driver_to_pickup_km ?? null,
          pickup_distance_fee: (data as any).pickup_distance_fee ?? 0,
        },
        errand: {
          booking: mergedBooking,
          job: bundle.job,
          stops: bundle.stops,
          route_adjustments: bundle.routeAdjustments,
          fare: driverFare,
          pabili: errandPabiliAccounting(
            bundle.job,
            bundle.stops,
            bundle.pabiliFundEvents
          ),
        },
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ERRAND_DRIVER_CURRENT_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
