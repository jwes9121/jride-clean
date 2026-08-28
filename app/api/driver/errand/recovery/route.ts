import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import {
  errandFeatureEnabled,
  errandFareBreakdown,
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

    const body: any = await req.json().catch(() => ({}));
    const bookingId = text(body?.booking_id || body?.bookingId);
    const action = text(body?.action).toLowerCase();

    if (!bookingId || !action) {
      return NextResponse.json(
        { ok: false, error: "MISSING_ACTION_OR_BOOKING" },
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
    let rpcName = "";
    if (action === "arrive_return") {
      rpcName = "errand_driver_arrive_unreachable_return_v1";
    } else if (action === "complete_return") {
      rpcName = "errand_driver_complete_unreachable_return_v1";
    } else {
      return NextResponse.json(
        { ok: false, error: "UNKNOWN_ERRAND_RECOVERY_ACTION", action },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const { data, error } = await admin.rpc(rpcName, {
      p_booking_id: bookingId,
      p_driver_id: identity.driverId,
    });
    if (error) {
      return NextResponse.json(
        { ok: false, error: "ERRAND_RECOVERY_RPC_FAILED", message: error.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const result: any = data || {};
    if (result.ok === false) {
      const err = text(result.error) || "ERRAND_RECOVERY_ACTION_BLOCKED";
      return NextResponse.json(
        { ...result, ok: false },
        { status: blockedStatus(err), headers: noStoreHeaders() }
      );
    }

    let settlement: any = null;
    if (action === "complete_return") {
      const settled = await admin.rpc("settle_completed_errand_wallet_v1", {
        p_booking_id: bookingId,
        p_settled_by: "driver_errand_recovery",
      });

      if (settled.error) {
        return NextResponse.json(
          {
            ok: false,
            error: "ERRAND_RECOVERY_SETTLEMENT_RPC_FAILED",
            message: settled.error.message,
            recovery: result,
          },
          { status: 500, headers: noStoreHeaders() }
        );
      }

      settlement = settled.data || {};
      if (settlement.ok === false) {
        return NextResponse.json(
          {
            ok: false,
            error: settlement.error || "ERRAND_RECOVERY_SETTLEMENT_BLOCKED",
            recovery: result,
            settlement,
          },
          { status: 409, headers: noStoreHeaders() }
        );
      }
    }

    const bundle = await loadErrandBundleByBookingId(bookingId);

    return NextResponse.json(
      {
        ...result,
        ok: true,
        auth_mode: identity.authMode,
        settlement,
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
        error: "ERRAND_RECOVERY_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
