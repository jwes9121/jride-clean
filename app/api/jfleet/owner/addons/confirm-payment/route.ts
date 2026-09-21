import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  jfleetFeatureFlagEnabled,
  requireJfleetOwner,
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

  const auth = await requireJfleetOwner(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code, message: auth.message },
      { status: auth.status, headers }
    );
  }

  const body = await req.json().catch(() => ({}));
  const addonId = clean(body?.addon_id, 80);
  if (!addonId) {
    return NextResponse.json(
      {
        ok: false,
        code: "JFLEET_ADDON_REQUIRED",
        message: "Choose an accepted additional charge.",
      },
      { status: 400, headers }
    );
  }

  const idempotencyKey =
    clean(body?.idempotency_key, 120) ||
    "JFLEET-ADDON-PAY-" + randomUUID().replace(/-/g, "").toUpperCase();

  const admin = supabaseAdmin({ noStore: true });
  const result = await admin.rpc("jfleet_owner_confirm_addon_payment_v1", {
    p_addon_id: addonId,
    p_owner_user_id: auth.user.id,
    p_payment_channel: clean(body?.payment_channel, 80) || null,
    p_payment_reference: clean(body?.payment_reference, 180) || null,
    p_idempotency_key: idempotencyKey,
    p_notes: clean(body?.notes, 1000) || null,
    p_now: new Date().toISOString(),
  });

  if (result.error) {
    const message = String(result.error.message || "");
    let userMessage = "The additional-charge payment could not be confirmed.";
    if (message.includes("NOT_ACCEPTED")) {
      userMessage = "The customer must accept this additional charge first.";
    } else if (message.includes("REQUIRES_ACTIVE_TRIP")) {
      userMessage = "Additional-charge payment confirmation is allowed only while the trip is active.";
    }

    return NextResponse.json(
      { ok: false, code: "JFLEET_ADDON_PAYMENT_REJECTED", message: userMessage },
      { status: 409, headers }
    );
  }

  return NextResponse.json(
    { ...(result.data as object), idempotency_key: idempotencyKey },
    { status: 200, headers }
  );
}
