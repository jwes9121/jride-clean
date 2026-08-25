import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import {
  errandFeatureEnabled,
  errandFareBreakdown,
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
      .select("id,booking_code,status,updated_at")
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

    if (!data?.id) {
      return NextResponse.json(
        { ok: true, errand: null, auth_mode: identity.authMode },
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

    return NextResponse.json(
      {
        ok: true,
        auth_mode: identity.authMode,
        errand: {
          booking: bundle.booking,
          job: bundle.job,
          stops: bundle.stops,
          fare: errandFareBreakdown(bundle.booking),
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
