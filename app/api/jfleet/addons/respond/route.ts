import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  jfleetFeatureFlagEnabled,
  requireJfleetPassenger,
} from "@/lib/jfleet/server";

export const dynamic = "force-dynamic";

function clean(value: unknown, max = 80): string {
  return String(value ?? "").trim().slice(0, max);
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
  const addonId = clean(body?.addon_id);
  const response = clean(body?.response, 20).toLowerCase();

  if (!addonId || !["accept", "decline"].includes(response)) {
    return NextResponse.json(
      {
        ok: false,
        code: "JFLEET_ADDON_RESPONSE_INVALID",
        message: "Choose Accept or Decline for the additional charge.",
      },
      { status: 400, headers }
    );
  }

  const admin = supabaseAdmin({ noStore: true });
  const result = await admin.rpc("jfleet_customer_respond_addon_v1", {
    p_addon_id: addonId,
    p_passenger_user_id: auth.user.id,
    p_response: response,
    p_now: new Date().toISOString(),
  });

  if (result.error) {
    const message = String(result.error.message || "");
    let userMessage = "The additional-charge response could not be saved.";
    if (message.includes("NOT_PENDING")) {
      userMessage = "This additional-charge proposal has already been resolved.";
    } else if (message.includes("REQUIRES_ACTIVE_TRIP")) {
      userMessage = "The trip is no longer active.";
    }

    return NextResponse.json(
      { ok: false, code: "JFLEET_ADDON_RESPONSE_REJECTED", message: userMessage },
      { status: 409, headers }
    );
  }

  return NextResponse.json(result.data, { status: 200, headers });
}
