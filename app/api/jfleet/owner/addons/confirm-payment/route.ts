import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  jfleetFeatureFlagEnabled,
  requireJfleetOwner,
} from "@/lib/jfleet/server";
import {
  addonPaymentRequest,
  addonPaymentScope,
  sameAddonPayment,
  type AddonPaymentReceipt,
  type AddonPaymentRequest,
} from "@/lib/jfleet/ownerAddonPayment";
import { PAYMENT_KEY } from "@/lib/jfleet/ownerPayment";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };

type Owner = Extract<Awaited<ReturnType<typeof requireJfleetOwner>>, { ok: true }>;
type Admin = ReturnType<typeof supabaseAdmin>;

class AddonPaymentError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function replyError(error: unknown) {
  const known =
    error instanceof AddonPaymentError
      ? error
      : new AddonPaymentError(
          503,
          "JFLEET_ADDON_PAYMENT_CHECK_FAILED",
          "Could not verify the saved additional-charge payment. Keep its request and retry or check it; do not enter it again."
        );
  return NextResponse.json(
    { ok: false, code: known.code, message: known.message },
    { status: known.status, headers }
  );
}

async function owner(req: Request): Promise<Owner> {
  if (!jfleetFeatureFlagEnabled()) {
    throw new AddonPaymentError(
      503,
      "JFLEET_NOT_ENABLED",
      "JFleet is not enabled yet."
    );
  }
  const auth = await requireJfleetOwner(req);
  if (!auth.ok) {
    throw new AddonPaymentError(auth.status, auth.code, auth.message);
  }
  if (auth.partner.status !== "active") {
    throw new AddonPaymentError(
      403,
      "JFLEET_OWNER_NOT_ACTIVE",
      "This transport account is not active."
    );
  }
  return auth;
}

function bind(
  auth: Owner,
  request: { expected_owner_id?: string; expected_partner_id?: string }
) {
  if (
    (request.expected_owner_id !== undefined &&
      request.expected_owner_id !== auth.user.id) ||
    (request.expected_partner_id !== undefined &&
      request.expected_partner_id !== auth.partner.id)
  ) {
    throw new AddonPaymentError(
      409,
      "JFLEET_ADDON_PAYMENT_ACCOUNT_CHANGED",
      "The logged-in owner changed. Sign in to the original account to recover this additional-charge payment."
    );
  }
}

async function addon(
  admin: Admin,
  auth: Owner,
  addonId: string,
  bookingId: string
) {
  const add = await admin
    .from("jfleet_addons")
    .select(
      "id,booking_id,total_amount,status,payment_confirmed_at,description"
    )
    .eq("id", addonId)
    .eq("booking_id", bookingId)
    .maybeSingle();

  if (add.error) throw add.error;
  if (!add.data) {
    throw new AddonPaymentError(
      409,
      "JFLEET_ADDON_PAYMENT_NOT_FOUND",
      "This additional charge is not available."
    );
  }

  const booking = await admin
    .from("jfleet_bookings")
    .select("id,booking_code,partner_id,status,addon_total,final_trip_value,jride_commission_amount,partner_net_amount")
    .eq("id", bookingId)
    .eq("partner_id", auth.partner.id)
    .maybeSingle();

  if (booking.error) throw booking.error;
  if (!booking.data) {
    throw new AddonPaymentError(
      409,
      "JFLEET_ADDON_PAYMENT_BOOKING_NOT_FOUND",
      "This booking is not available to this transport account."
    );
  }

  return { addon: add.data, booking: booking.data };
}

async function receipt(
  admin: Admin,
  auth: Owner,
  addonId: string,
  bookingId: string
): Promise<AddonPaymentReceipt | null> {
  const query = await admin
    .from("jfleet_payments")
    .select(
      "id,booking_id,addon_id,idempotency_key,payment_kind,amount,status,payment_channel,payment_reference,notes,confirmed_at,confirmed_by_owner_user_id"
    )
    .eq("addon_id", addonId)
    .maybeSingle();

  if (query.error) throw query.error;
  if (!query.data) return null;

  const row = query.data;
  if (
    row.booking_id !== bookingId ||
    row.addon_id !== addonId ||
    row.payment_kind !== "addon" ||
    row.status !== "confirmed" ||
    row.confirmed_by_owner_user_id !== auth.user.id ||
    !row.confirmed_at ||
    typeof row.idempotency_key !== "string" ||
    !PAYMENT_KEY.test(row.idempotency_key)
  ) {
    throw new AddonPaymentError(
      409,
      "JFLEET_ADDON_PAYMENT_RECORD_REVIEW_REQUIRED",
      "This additional charge has a payment record that requires JRide review. Do not record another payment."
    );
  }

  return {
    owner_user_id: auth.user.id,
    partner_id: auth.partner.id,
    booking_id: bookingId,
    addon_id: addonId,
    payment_id: row.id,
    idempotency_key: row.idempotency_key,
    amount: Number(row.amount),
    payment_channel: String(row.payment_channel || ""),
    payment_reference: String(row.payment_reference || ""),
    notes: String(row.notes || ""),
    status: "confirmed",
    confirmed_at: row.confirmed_at,
  };
}

function receiptResponse(
  saved: AddonPaymentReceipt,
  context: Awaited<ReturnType<typeof addon>>,
  replayed: boolean,
  reconciled: boolean
) {
  return {
    ok: true,
    found: true,
    replayed,
    reconciled,
    receipt: saved,
    addon_id: context.addon.id,
    booking_id: context.booking.id,
    booking_code: context.booking.booking_code,
    addon_status: context.addon.status,
    addon_total: context.booking.addon_total,
    final_trip_value: context.booking.final_trip_value,
    jride_commission_amount: context.booking.jride_commission_amount,
    partner_net_amount: context.booking.partner_net_amount,
  };
}

export async function GET(req: Request) {
  try {
    const auth = await owner(req);
    const params = new URL(req.url).searchParams;
    let scope;
    try {
      scope = addonPaymentScope({
        owner_user_id: params.get("owner_user_id"),
        partner_id: params.get("partner_id"),
        booking_id: params.get("booking_id"),
        addon_id: params.get("addon_id"),
      });
    } catch {
      throw new AddonPaymentError(
        400,
        "JFLEET_ADDON_PAYMENT_LOOKUP_INVALID",
        "Provide the original additional-charge payment context."
      );
    }

    bind(auth, {
      expected_owner_id: scope.owner_user_id,
      expected_partner_id: scope.partner_id,
    });

    const admin = supabaseAdmin({ noStore: true });
    const context = await addon(admin, auth, scope.addon_id, scope.booking_id);
    const saved = await receipt(
      admin,
      auth,
      scope.addon_id,
      scope.booking_id
    );

    return NextResponse.json(
      saved
        ? receiptResponse(saved, context, true, false)
        : { ok: true, found: false, receipt: null },
      { status: 200, headers }
    );
  } catch (error) {
    return replyError(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await owner(req);
    let request: AddonPaymentRequest;

    try {
      const raw = await req.text();
      if (raw.length > 8000) {
        throw new Error("Additional-charge payment request is too large.");
      }
      request = addonPaymentRequest(JSON.parse(raw));
    } catch (error) {
      throw new AddonPaymentError(
        400,
        "JFLEET_ADDON_PAYMENT_INPUT_INVALID",
        error instanceof Error
          ? error.message
          : "Invalid additional-charge payment request."
      );
    }

    bind(auth, request);
    const admin = supabaseAdmin({ noStore: true });
    let context = await addon(
      admin,
      auth,
      request.addon_id,
      request.booking_id
    );

    if (Number(context.addon.total_amount) !== request.amount) {
      throw new AddonPaymentError(
        409,
        "JFLEET_ADDON_PAYMENT_AMOUNT_CHANGED",
        "The additional charge changed. Reload the booking before confirming payment."
      );
    }

    const existing = await receipt(
      admin,
      auth,
      request.addon_id,
      request.booking_id
    );

    if (existing) {
      const sameKey = existing.idempotency_key === request.idempotency_key;
      if (sameKey && !sameAddonPayment(existing, request)) {
        throw new AddonPaymentError(
          409,
          "JFLEET_ADDON_PAYMENT_IDEMPOTENCY_CONFLICT",
          "That saved request key belongs to different payment details. Recover the original request."
        );
      }
      return NextResponse.json(
        receiptResponse(existing, context, true, !sameKey),
        { status: 200, headers }
      );
    }

    const result = await admin.rpc(
      "jfleet_owner_confirm_addon_payment_v2",
      {
        p_addon_id: request.addon_id,
        p_owner_user_id: auth.user.id,
        p_payment_channel: request.payment_channel || null,
        p_payment_reference: request.payment_reference || null,
        p_idempotency_key: request.idempotency_key,
        p_notes: request.notes || null,
        p_now: new Date().toISOString(),
      }
    );

    if (result.error) {
      const message = String(result.error.message || "");
      if (
        message.includes("ALREADY_RECORDED") ||
        message.includes("IDEMPOTENCY_CONFLICT")
      ) {
        const raced = await receipt(
          admin,
          auth,
          request.addon_id,
          request.booking_id
        );
        if (raced) {
          context = await addon(
            admin,
            auth,
            request.addon_id,
            request.booking_id
          );
          return NextResponse.json(
            receiptResponse(
              raced,
              context,
              true,
              raced.idempotency_key !== request.idempotency_key
            ),
            { status: 200, headers }
          );
        }
      }

      let messageForOwner =
        "Additional-charge payment did not return a verified receipt. Check or retry this same saved request; do not enter it again.";
      if (message.includes("NOT_ACCEPTED")) {
        messageForOwner =
          "The customer must accept this additional charge first.";
      } else if (message.includes("REQUIRES_ACTIVE_TRIP")) {
        messageForOwner =
          "Additional-charge payment confirmation is allowed only while the trip is active.";
      }

      throw new AddonPaymentError(
        message.includes("JFLEET_") ? 409 : 503,
        "JFLEET_ADDON_PAYMENT_NOT_CONFIRMED",
        messageForOwner
      );
    }

    const saved = await receipt(
      admin,
      auth,
      request.addon_id,
      request.booking_id
    );
    if (!saved) {
      throw new Error("Receipt unavailable after add-on payment transaction");
    }

    context = await addon(
      admin,
      auth,
      request.addon_id,
      request.booking_id
    );

    return NextResponse.json(
      receiptResponse(
        saved,
        context,
        false,
        saved.idempotency_key !== request.idempotency_key
      ),
      { status: 200, headers }
    );
  } catch (error) {
    return replyError(error);
  }
}
