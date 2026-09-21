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
  const bookingId = clean(body?.booking_id, 80);
  const kind = clean(body?.payment_kind, 40).toLowerCase();
  const amount = Number(body?.amount);

  if (!bookingId || !["reservation", "balance", "full_payment"].includes(kind)) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_PAYMENT_INPUT_INVALID", message: "Review the booking and payment type." },
      { status: 400, headers }
    );
  }

  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_PAYMENT_AMOUNT_INVALID", message: "Enter a valid payment amount." },
      { status: 400, headers }
    );
  }

  const idempotencyKey =
    clean(body?.idempotency_key, 120) ||
    "JFLEET-PAY-" + randomUUID().replace(/-/g, "").toUpperCase();

  const admin = supabaseAdmin({ noStore: true });
  const result = await admin.rpc("jfleet_owner_confirm_payment_v1", {
    p_booking_id: bookingId,
    p_owner_user_id: auth.user.id,
    p_payment_kind: kind,
    p_amount: amount,
    p_payment_channel: clean(body?.payment_channel, 80) || null,
    p_payment_reference: clean(body?.payment_reference, 180) || null,
    p_idempotency_key: idempotencyKey,
    p_notes: clean(body?.notes, 1000) || null,
    p_now: new Date().toISOString(),
  });

  if (result.error) {
    const message = String(result.error.message || "");
    const known =
      message.includes("JFLEET_BOOKING") ||
      message.includes("JFLEET_OWNER") ||
      message.includes("JFLEET_PAYMENT");
    return NextResponse.json(
      {
        ok: false,
        code: known ? "JFLEET_PAYMENT_REJECTED" : "JFLEET_PAYMENT_CONFIRM_FAILED",
        message: known
          ? "The payment could not be confirmed for this booking. Refresh and review its status."
          : "The payment confirmation could not be saved.",
      },
      { status: known ? 409 : 500, headers }
    );
  }

  return NextResponse.json(
    { ...(result.data as object), idempotency_key: idempotencyKey },
    { status: 200, headers }
  );
}
