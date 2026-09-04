import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  errandFareBreakdown,
  errandFeatureEnabled,
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
    if (!bookingId) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_ID_REQUIRED" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const admin = supabaseAdmin();
    const { data: owned, error: ownedError } = await admin
      .from("bookings")
      .select("id,status,service_type,created_by_user_id")
      .eq("id", bookingId)
      .maybeSingle();

    if (ownedError || !owned?.id) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_NOT_FOUND" },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    if (text(owned.created_by_user_id) !== userId) {
      return NextResponse.json(
        { ok: false, error: "PASSENGER_NOT_BOOKING_OWNER" },
        { status: 403, headers: noStoreHeaders() }
      );
    }

    if (text(owned.service_type).toLowerCase() !== "errand") {
      return NextResponse.json(
        { ok: false, error: "NOT_ERRAND_BOOKING" },
        { status: 409, headers: noStoreHeaders() }
      );
    }

    if (text(owned.status).toLowerCase() !== "completed") {
      return NextResponse.json(
        { ok: false, error: "ERRAND_NOT_COMPLETED", status: owned.status },
        { status: 409, headers: noStoreHeaders() }
      );
    }

    const bundle = await loadErrandBundleByBookingId(bookingId);
    if (!bundle.ok) {
      return NextResponse.json(
        { ok: false, error: bundle.error },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const fare = errandFareBreakdown(
      bundle.booking,
      bundle.job,
      bundle.settings
    );
    const pabili = errandPabiliAccounting(
      bundle.job,
      bundle.stops,
      bundle.pabiliFundEvents
    );

    return NextResponse.json(
      {
        ok: true,
        receipt: {
          booking_id: (bundle.booking as any).id,
          booking_code: (bundle.booking as any).booking_code,
          completed_at: (bundle.booking as any).completed_at || null,
          starting_fare: (bundle.job as any).starting_fare_at_confirmation ?? null,
          final_fare: fare.total_errand_fare,
          base_fare: fare.base_fare,
          pickup_distance_fee: fare.pickup_distance_fee,
          distance_fare: fare.distance_fare,
          extra_stop_fee: fare.extra_stop_fee,
          waiting_minutes: (bundle.booking as any).waiting_minutes ?? 0,
          waiting_fee: fare.waiting_fee,
          elevation_surcharge: fare.elevation_surcharge,
          heavy_load_fee: fare.heavy_load_fee,
          company_cut: fare.company_cut,
          driver_payout: fare.driver_payout,
          pabili,
        },
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ERRAND_COMPLETED_RECEIPT_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
