import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  errandFeatureEnabled,
  errandFareBreakdown,
  errandPabiliAccounting,
  loadErrandBundleByBookingId,
} from "@/lib/errand/server";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function getBearerToken(req: Request): string | null {
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

function secondsAgo(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 1000));
}

function validSince(value: string): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export async function GET(req: Request) {
  try {
    if (!errandFeatureEnabled()) {
      return NextResponse.json(
        { ok: false, error: "ERRAND_BOOKING_NOT_ENABLED" },
        { status: 503, headers: noStoreHeaders() }
      );
    }

    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHED" },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    const auth = createClient();
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    const userId = text(authData?.user?.id);
    if (authError || !userId) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHED" },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    const url = new URL(req.url);
    const bookingId = text(url.searchParams.get("booking_id"));
    const since = validSince(text(url.searchParams.get("since")));

    if (!bookingId) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_ID_REQUIRED" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const bundle = await loadErrandBundleByBookingId(bookingId);
    if (!bundle.ok) {
      return NextResponse.json(
        { ok: false, error: bundle.error },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    if (text((bundle.booking as any).created_by_user_id) !== userId) {
      return NextResponse.json(
        { ok: false, error: "PASSENGER_NOT_BOOKING_OWNER" },
        { status: 403, headers: noStoreHeaders() }
      );
    }

    const admin = supabaseAdmin();
    const driverId = text(
      (bundle.booking as any).assigned_driver_id ||
        (bundle.booking as any).driver_id
    );

    let driverLocation: any = null;
    if (driverId) {
      const locationRes = await admin
        .from("driver_locations")
        .select("driver_id,lat,lng,status,updated_at,town,vehicle_type")
        .eq("driver_id", driverId)
        .maybeSingle();

      if (!locationRes.error && locationRes.data) {
        driverLocation = {
          ...locationRes.data,
          seconds_since_update: secondsAgo((locationRes.data as any).updated_at),
        };
      }
    }

    let breadcrumbQuery = admin
      .from("errand_gps_breadcrumbs")
      .select(
        "id,booking_id,driver_id,lat,lng,recorded_at,source_updated_at,booking_status,errand_stage,route_phase,source"
      )
      .eq("booking_id", bookingId)
      .order("recorded_at", { ascending: true })
      .limit(1000);

    if (since) {
      breadcrumbQuery = breadcrumbQuery.gt("recorded_at", since);
    }

    const breadcrumbRes = await breadcrumbQuery;
    if (breadcrumbRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "ERRAND_BREADCRUMB_READ_FAILED",
          message: breadcrumbRes.error.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const breadcrumbs = Array.isArray(breadcrumbRes.data)
      ? breadcrumbRes.data
      : [];
    const lastBreadcrumb = breadcrumbs.length
      ? breadcrumbs[breadcrumbs.length - 1]
      : null;

    return NextResponse.json(
      {
        ok: true,
        booking_id: bookingId,
        booking_status: (bundle.booking as any).status,
        errand_stage: (bundle.job as any).errand_stage,
        current_stop_sequence: (bundle.job as any).current_stop_sequence,
        driver_location: driverLocation,
        actual_route: {
          basis: "driver_gps_breadcrumbs",
          billing_source: false,
          sampled_max_frequency_seconds: 10,
          points: breadcrumbs,
          next_since: text((lastBreadcrumb as any)?.recorded_at) || since,
        },
        confirmed_route: {
          basis: "mapbox_confirmed_driving_route",
          billing_source: true,
          distance_km: (bundle.job as any).confirmed_route_distance_km,
          duration_seconds: (bundle.job as any).confirmed_route_duration_seconds,
          legs: (bundle.job as any).confirmed_route_legs || [],
          adjustments: bundle.routeAdjustments,
        },
        fare: errandFareBreakdown(
          bundle.booking,
          bundle.job,
          bundle.settings
        ),
        pabili: errandPabiliAccounting(
          bundle.job,
          bundle.stops,
          bundle.pabiliFundEvents
        ),
        map_note: "Fare is based on the confirmed route, not the driver's live path.",
        route_policy: {
          pickup_route_billing: "pickup_distance_surcharge_only",
          confirmed_errand_route_billing: "routed_road_distance",
          actual_gps_route_billing: "never",
        },
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ERRAND_TRACKING_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
