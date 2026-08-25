import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import { errandFeatureEnabled } from "@/lib/errand/server";
import { assignErrandStage0 } from "@/lib/errand/assignStage0";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function headers() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

export async function POST(req: Request) {
  try {
    if (!errandFeatureEnabled()) {
      return NextResponse.json(
        { ok: false, error: "ERRAND_BOOKING_NOT_ENABLED" },
        { status: 503, headers: headers() }
      );
    }

    const body = await req.json().catch(() => ({}));
    const bookingId = text(body?.booking_id || body?.bookingId);
    const action = text(body?.action).toLowerCase();

    if (!bookingId || !action) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_ID_AND_ACTION_REQUIRED" },
        { status: 400, headers: headers() }
      );
    }

    const identity = await resolveDriverRequest(
      req,
      text(body?.driver_id || body?.driverId)
    );
    if (!identity.ok || !identity.driverId) {
      return NextResponse.json(
        { ok: false, error: identity.error || "NOT_AUTHED" },
        { status: identity.status || 401, headers: headers() }
      );
    }

    const admin = supabaseAdmin();
    let rpcName = "";
    let rpcArgs: Record<string, unknown> = {};

    if (action === "decline") {
      rpcName = "errand_driver_decline_v1";
      rpcArgs = {
        p_booking_id: bookingId,
        p_driver_id: identity.driverId,
        p_reason_code: text(body?.reason_code) || "driver_declined",
      };
    } else if (action === "expire_offer") {
      rpcName = "errand_driver_expire_offer_v1";
      rpcArgs = {
        p_booking_id: bookingId,
        p_driver_id: identity.driverId,
      };
    } else if (action === "vehicle_not_suitable") {
      rpcName = "errand_driver_vehicle_not_suitable_v1";
      rpcArgs = {
        p_booking_id: bookingId,
        p_driver_id: identity.driverId,
        p_confirmed_cargo_weight_kg: numberOrNull(body?.confirmed_cargo_weight_kg),
        p_reason_code:
          text(body?.reason_code) || "vehicle_or_load_not_suitable",
      };
    } else {
      return NextResponse.json(
        { ok: false, error: "UNKNOWN_ERRAND_OFFER_ACTION", action },
        { status: 400, headers: headers() }
      );
    }

    const resultRes = await admin.rpc(rpcName, rpcArgs);
    if (resultRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "ERRAND_OFFER_ACTION_RPC_FAILED",
          message: resultRes.error.message,
        },
        { status: 500, headers: headers() }
      );
    }

    const result = (resultRes.data as any) || {};
    if (result.ok === false) {
      const error = text(result.error) || "ERRAND_OFFER_ACTION_BLOCKED";
      const status = error === "DRIVER_NOT_ASSIGNED" ? 403 : 409;
      return NextResponse.json(
        { ...result, ok: false },
        { status, headers: headers() }
      );
    }

    const reassignment = await assignErrandStage0({ bookingId });

    return NextResponse.json(
      {
        ...result,
        ok: true,
        auth_mode: identity.authMode,
        reassignment,
      },
      { status: 200, headers: headers() }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ERRAND_OFFER_ACTION_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      },
      { status: 500, headers: headers() }
    );
  }
}
