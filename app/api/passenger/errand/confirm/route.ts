import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  errandFeatureEnabled,
  errandFareBreakdown,
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

export async function POST(req: Request) {
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

    const body = await req.json().catch(() => ({}));
    const bookingId = text(body?.booking_id || body?.bookingId);

    if (!bookingId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING_ID" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const admin = supabaseAdmin();
    const { data, error } = await admin.rpc("errand_passenger_confirm_task_v1", {
      p_booking_id: bookingId,
      p_user_id: userId,
    });

    if (error) {
      return NextResponse.json(
        { ok: false, error: "ERRAND_CONFIRM_RPC_FAILED", message: error.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const result = (data as any) || {};
    if (result.ok === false) {
      const err = text(result.error) || "ERRAND_CONFIRM_BLOCKED";
      const status =
        err === "PASSENGER_NOT_BOOKING_OWNER"
          ? 403
          : err === "BOOKING_NOT_FOUND" || err === "ERRAND_JOB_NOT_FOUND"
            ? 404
            : 409;

      return NextResponse.json(
        { ...result, ok: false },
        { status, headers: noStoreHeaders() }
      );
    }

    const bundle = await loadErrandBundleByBookingId(bookingId);

    return NextResponse.json(
      {
        ...result,
        ok: true,
        errand: bundle.ok
          ? {
              booking: bundle.booking,
              job: bundle.job,
              stops: bundle.stops,
              fare: errandFareBreakdown(bundle.booking),
            }
          : null,
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ERRAND_PASSENGER_CONFIRM_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
