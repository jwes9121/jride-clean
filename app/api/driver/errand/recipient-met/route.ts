import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import {
  errandFareBreakdown,
  errandFeatureEnabled,
  loadErrandBundleByBookingId,
} from "@/lib/errand/server";

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

function blockedStatus(error: string): number {
  if (error === "DRIVER_NOT_ASSIGNED") return 403;
  if (error === "BOOKING_NOT_FOUND" || error === "ERRAND_JOB_NOT_FOUND") return 404;
  if (error.includes("REQUIRED") || error.includes("INVALID")) return 400;
  return 409;
}

export async function POST(req: Request) {
  try {
    if (!errandFeatureEnabled()) {
      return NextResponse.json(
        { ok: false, error: "ERRAND_BOOKING_NOT_ENABLED" },
        { status: 503, headers: noStoreHeaders() }
      );
    }

    const body = await req.json().catch(() => ({}));
    const bookingId = text(body?.booking_id || body?.bookingId);
    if (!bookingId) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_ID_REQUIRED" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const identity = await resolveDriverRequest(
      req,
      text(body?.driver_id || body?.driverId)
    );

    if (!identity.ok || !identity.driverId) {
      return NextResponse.json(
        { ok: false, error: identity.error || "NOT_AUTHED" },
        { status: identity.status || 401, headers: noStoreHeaders() }
      );
    }

    const admin = supabaseAdmin();
    const { data, error } = await admin.rpc(
      "errand_driver_mark_recipient_met_v1",
      {
        p_booking_id: bookingId,
        p_driver_id: identity.driverId,
      }
    );

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "ERRAND_RECIPIENT_MET_RPC_FAILED",
          message: error.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const result = (data as any) || {};
    if (result.ok === false) {
      const err = text(result.error) || "ERRAND_RECIPIENT_MET_BLOCKED";
      return NextResponse.json(
        { ...result, ok: false },
        { status: blockedStatus(err), headers: noStoreHeaders() }
      );
    }

    const bundle = await loadErrandBundleByBookingId(bookingId);

    return NextResponse.json(
      {
        ...result,
        ok: true,
        auth_mode: identity.authMode,
        errand: bundle.ok
          ? {
              booking: bundle.booking,
              job: bundle.job,
              stops: bundle.stops,
              route_adjustments: bundle.routeAdjustments,
              fare: errandFareBreakdown(
                bundle.booking,
                bundle.job,
                bundle.settings
              ),
            }
          : null,
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ERRAND_RECIPIENT_MET_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
