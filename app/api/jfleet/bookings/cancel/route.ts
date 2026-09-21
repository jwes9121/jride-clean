import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  jfleetFeatureFlagEnabled,
  requireJfleetPassenger,
} from "@/lib/jfleet/server";

export const dynamic = "force-dynamic";

function clean(value: unknown, max = 1000): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export async function POST(req: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };

  if (!jfleetFeatureFlagEnabled()) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_NOT_ENABLED", message: "JFleet is not enabled yet." },
      { status: 503, headers }
    );
  }

  const auth = await requireJfleetPassenger(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code, message: auth.message },
      { status: auth.status, headers }
    );
  }

  const body = await req.json().catch(() => ({}));
  const bookingId = clean(body?.booking_id, 80);
  const reason = clean(body?.reason, 1000);

  if (!bookingId) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_BOOKING_REQUIRED", message: "Choose a JFleet booking to cancel." },
      { status: 400, headers }
    );
  }

  const admin = supabaseAdmin({ noStore: true });
  const result = await admin.rpc("jfleet_cancel_customer_v1", {
    p_booking_id: bookingId,
    p_passenger_user_id: auth.user.id,
    p_reason: reason || null,
    p_now: new Date().toISOString(),
  });

  if (result.error) {
    const message = String(result.error.message || "");
    let userMessage = "The booking could not be cancelled.";
    if (message.includes("NOT_CANCELLABLE")) {
      userMessage = "This booking can no longer be cancelled through the customer flow.";
    } else if (message.includes("ALREADY_DUE")) {
      userMessage = "The scheduled trip has already started or is due now.";
    }

    return NextResponse.json(
      { ok: false, code: "JFLEET_CANCEL_REJECTED", message: userMessage },
      { status: 409, headers }
    );
  }

  return NextResponse.json(result.data, { status: 200, headers });
}
