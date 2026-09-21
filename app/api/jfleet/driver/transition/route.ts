import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  jfleetFeatureFlagEnabled,
  requireJfleetDriver,
} from "@/lib/jfleet/server";

export const dynamic = "force-dynamic";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export async function POST(req: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };

  if (!jfleetFeatureFlagEnabled()) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_NOT_ENABLED", message: "JFleet is not enabled yet." },
      { status: 503, headers }
    );
  }

  const auth = await requireJfleetDriver(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code, message: auth.message },
      { status: auth.status, headers }
    );
  }

  const body = await req.json().catch(() => ({}));
  const bookingId = clean(body?.booking_id);
  const action = clean(body?.action).toLowerCase();

  if (!bookingId || !["en_route", "arrived", "start", "complete"].includes(action)) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_DRIVER_ACTION_INVALID", message: "Choose a valid JFleet trip action." },
      { status: 400, headers }
    );
  }

  const admin = supabaseAdmin({ noStore: true });
  const result = await admin.rpc("jfleet_driver_transition_v1", {
    p_booking_id: bookingId,
    p_driver_id: auth.driver.id,
    p_action: action,
    p_now: new Date().toISOString(),
  });

  if (result.error) {
    const message = String(result.error.message || "");
    let userMessage = "That trip action is not available.";
    if (message.includes("ORIGINAL_QUOTE_NOT_FULLY_PAID")) {
      userMessage = "The owner must confirm full payment of the original quotation before the trip can start.";
    } else if (message.includes("BOOKING_NOT_FOUND")) {
      userMessage = "This booking is not assigned to your JFleet driver account.";
    }
    return NextResponse.json(
      { ok: false, code: "JFLEET_DRIVER_ACTION_REJECTED", message: userMessage },
      { status: 409, headers }
    );
  }

  return NextResponse.json(result.data, { status: 200, headers });
}
