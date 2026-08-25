import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  errandFeatureEnabled,
  errandFareBreakdown,
  errandPabiliAccounting,
  loadErrandBundleByBookingId,
} from "@/lib/errand/server";

const ACTIVE_STATUSES = [
  "requested",
  "pending",
  "searching",
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

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("bookings")
      .select("id,booking_code,status,assigned_driver_id,driver_id,updated_at")
      .eq("service_type", "errand")
      .eq("created_by_user_id", userId)
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

    if (!data?.id) {
      return NextResponse.json(
        { ok: true, errand: null },
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

    const driverId = text(
      (bundle.booking as any).assigned_driver_id || (bundle.booking as any).driver_id
    );
    let driverLocation: any = null;
    let driver: any = null;

    if (driverId) {
      const [driverLoc, driverProfile] = await Promise.all([
        admin
          .from("driver_locations")
          .select("driver_id,lat,lng,status,updated_at,town,vehicle_type")
          .eq("driver_id", driverId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin
          .from("driver_profiles")
          .select(
            "driver_id,full_name,callsign,municipality,vehicle_type,plate_number,phone,photo_url"
          )
          .eq("driver_id", driverId)
          .limit(1)
          .maybeSingle(),
      ]);

      if (!driverLoc.error && driverLoc.data) driverLocation = driverLoc.data;
      if (!driverProfile.error && driverProfile.data) driver = driverProfile.data;
    }

    return NextResponse.json(
      {
        ok: true,
        errand: {
          booking: bundle.booking,
          job: bundle.job,
          stops: bundle.stops,
          route_adjustments: bundle.routeAdjustments,
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
          driver,
          driver_location: driverLocation,
          map_note: "Fare is based on the confirmed route, not the driver's live path.",
        },
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ERRAND_PASSENGER_CURRENT_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
