import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  jfleetFeatureFlagEnabled,
  requireJfleetPassenger,
} from "@/lib/jfleet/server";

export const dynamic = "force-dynamic";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function bookingCode(): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return "JFB-" + stamp + "-" + randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
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
  const inquiryId = clean(body?.inquiry_id);
  const quoteId = clean(body?.quote_id);

  if (!inquiryId || !quoteId) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_QUOTE_REQUIRED", message: "Choose a valid JFleet quotation." },
      { status: 400, headers }
    );
  }

  const admin = supabaseAdmin({ noStore: true });
  const result = await admin.rpc("jfleet_accept_quote_v1", {
    p_inquiry_id: inquiryId,
    p_quote_id: quoteId,
    p_passenger_user_id: auth.user.id,
    p_booking_code: bookingCode(),
    p_now: new Date().toISOString(),
  });

  if (result.error) {
    const message = String(result.error.message || "");
    let userMessage = "The quotation could not be accepted.";
    if (message.includes("QUOTE_EXPIRED")) {
      userMessage = "This quotation has expired. Request a new quotation.";
    } else if (message.includes("QUOTE_NOT_ACCEPTABLE")) {
      userMessage = "This quotation is no longer available. Refresh to see the current quotation.";
    } else if (message.includes("ITINERARY_NOT_CURRENT")) {
      userMessage = "The itinerary has changed. Review the latest quotation before accepting.";
    }

    return NextResponse.json(
      { ok: false, code: "JFLEET_QUOTE_ACCEPT_REJECTED", message: userMessage },
      { status: 409, headers }
    );
  }

  return NextResponse.json(result.data, { status: 200, headers });
}
