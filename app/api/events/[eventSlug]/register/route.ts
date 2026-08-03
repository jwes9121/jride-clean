import { createHmac } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_GUESTS = 3;

type GuestInput = {
  fullName?: unknown;
  relationship?: unknown;
  mobileNumber?: unknown;
  ticketNumber?: unknown;
  claimCode?: unknown;
};

type PartyResultPerson = {
  attendeeId: string;
  registrationNumber: string;
  qrToken: string;
  relationship?: string;
  ticketNumber: string | null;
  packageName: string | null;
  price: number | string | null;
};

type PartyRpcResult = {
  success: boolean;
  resultCode: string;
  message: string;
  primary?: PartyResultPerson;
  guests?: PartyResultPerson[];
  existingRegistration?: {
    attendeeId: string;
    registrationNumber: string;
    qrToken: string;
  };
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function cleanPhone(value: unknown) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// Mirrors the ticket-register and Golden Jubilarian routes exactly - this
// codebase duplicates these small per-request helpers per route rather
// than centralizing them, so this route follows the same pattern rather
// than introducing a new shared module unprompted.
function getClientIp(req: NextRequest) {
  const forwarded = cleanText(req.headers.get("x-forwarded-for"));

  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return cleanText(req.headers.get("x-real-ip")) || "unknown";
}

function getRateLimitSecret() {
  return cleanText(process.env.JRIDE_EVENT_RATE_LIMIT_SECRET);
}

function buildClientKeyHash(req: NextRequest) {
  const secret = getRateLimitSecret();

  if (!secret) {
    throw new Error("JRIDE_EVENT_RATE_LIMIT_SECRET is not configured.");
  }

  const ip = getClientIp(req);
  const userAgent = cleanText(req.headers.get("user-agent")).slice(0, 500);

  return createHmac("sha256", secret)
    .update(`${ip}|${userAgent}`, "utf8")
    .digest("hex");
}

function statusForResultCode(resultCode: string) {
  switch (resultCode) {
    case "CLAIMED":
      return 201;

    case "RATE_LIMITED":
      return 429;

    case "DUPLICATE_MOBILE":
    case "DUPLICATE_MOBILE_IN_SUBMISSION":
    case "DUPLICATE_TICKET_IN_SUBMISSION":
    case "TICKET_UNAVAILABLE":
    case "EVENT_NOT_OPEN":
    case "REGISTRATION_NOT_STARTED":
    case "REGISTRATION_CLOSED":
    case "TOO_MANY_GUESTS":
      return 409;

    case "EVENT_NOT_FOUND":
      return 404;

    case "INVALID_REQUEST":
    case "INVALID_NAME":
    case "INVALID_MOBILE_NUMBER":
    case "INVALID_CLIENT_KEY":
    case "INVALID_TICKET":
    case "INVALID_GUEST_ANSWER":
      return 400;

    default:
      return 500;
  }
}

function buildEventPassUrl(
  eventSlug: string,
  registrationNumber: string,
  qrToken: string
) {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://app.jride.net";

  return (
    `${appUrl.replace(/\/$/, "")}` +
    `/events/${encodeURIComponent(eventSlug)}` +
    `/pass/${encodeURIComponent(registrationNumber)}` +
    `?token=${encodeURIComponent(qrToken)}`
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const eventSlug = cleanText(params.eventSlug);

    if (!eventSlug) {
      return noStore(
        {
          success: false,
          resultCode: "EVENT_NOT_FOUND",
          message: "Event was not found.",
        },
        404
      );
    }

    const body = await req.json().catch(() => ({}));

    // ---- Request-shape validation only. No ticket/mobile/duplicate
    // business validation here - that all belongs in the RPC. Unlike the
    // Golden Jubilarian route, there is no joinFunWalk/attendLunch gate
    // to check here at all: everyone registering through this route is
    // walking, so ticket + claim code are unconditionally required.

    const primaryFullName = cleanText(body.fullName);
    const primaryMobileNumber = cleanPhone(body.mobileNumber);
    const primaryNickname = cleanText(body.nickname);
    const primaryTicketNumber = cleanText(body.ticketNumber).toUpperCase();
    const primaryClaimCode = cleanText(body.claimCode).toUpperCase();

    if (!primaryTicketNumber || !primaryClaimCode) {
      return noStore(
        {
          success: false,
          resultCode: "INVALID_REQUEST",
          message: "Ticket number and claim code are required.",
        },
        400
      );
    }

    const guestsInput: GuestInput[] = Array.isArray(body.guests)
      ? body.guests
      : [];

    if (guestsInput.length > MAX_GUESTS) {
      return noStore(
        {
          success: false,
          resultCode: "TOO_MANY_GUESTS",
          message: `A maximum of ${MAX_GUESTS} guests can be registered online.`,
        },
        400
      );
    }

    for (let i = 0; i < guestsInput.length; i++) {
      const guest = guestsInput[i];

      const guestTicketNumber = cleanText(guest.ticketNumber);
      const guestClaimCode = cleanText(guest.claimCode);

      if (!guestTicketNumber || !guestClaimCode) {
        return noStore(
          {
            success: false,
            resultCode: "INVALID_GUEST_ANSWER",
            message: `Guest ${i + 1}: ticket number and claim code are required.`,
          },
          400
        );
      }
    }

    const clientKeyHash = buildClientKeyHash(req);

    const supabase = supabaseAdmin();

    const { data, error } = await supabase.rpc(
      "claim_public_ticketed_party_and_register",
      {
        p_event_slug: eventSlug,
        p_primary_full_name: primaryFullName,
        p_primary_mobile_number: primaryMobileNumber,
        p_primary_nickname: primaryNickname || null,
        p_primary_ticket_number: primaryTicketNumber,
        p_primary_claim_code: primaryClaimCode,
        p_guests: guestsInput.map((guest) => ({
          fullName: cleanText(guest.fullName),
          relationship: cleanText(guest.relationship),
          mobileNumber: cleanPhone(guest.mobileNumber) || null,
          ticketNumber: cleanText(guest.ticketNumber).toUpperCase(),
          claimCode: cleanText(guest.claimCode).toUpperCase(),
        })),
        p_client_key_hash: clientKeyHash,
      }
    );

    if (error) {
      throw new Error(error.message);
    }

    const result = data as PartyRpcResult | null;

    if (!result) {
      throw new Error("Registration returned no result.");
    }

    // Mirrors the Golden Jubilarian route's existing-registration
    // handling exactly: an already-registered primary mobile number is a
    // successful no-op, not an error. Nothing was created and no ticket
    // was claimed - this must be shown before any redirect, not silently
    // treated like a normal successful registration.
    if (result.success && result.resultCode === "EXISTING_REGISTRATION") {
      const existing = result.existingRegistration;

      return noStore(
        {
          success: true,
          resultCode: "EXISTING_REGISTRATION",
          participationRecorded: false,
          specialRegistrationNotApplied: true,
          message:
            "This mobile number already has an Event Pass. Please visit Event Registration and Assistance so your registration details can be updated.",
          attendeeId: existing?.attendeeId,
          registrationNumber: existing?.registrationNumber,
          qrToken: existing?.qrToken,
          eventPassUrl:
            existing?.registrationNumber && existing?.qrToken
              ? buildEventPassUrl(
                  eventSlug,
                  existing.registrationNumber,
                  existing.qrToken
                )
              : undefined,
        },
        200
      );
    }

    if (!result.success) {
      return noStore(
        {
          success: false,
          resultCode: result.resultCode,
          message: result.message || "Registration failed.",
        },
        statusForResultCode(result.resultCode)
      );
    }

    if (!result.primary) {
      throw new Error(
        "Registration succeeded but the primary Event Pass details are missing."
      );
    }

    const primaryEventPassUrl = buildEventPassUrl(
      eventSlug,
      result.primary.registrationNumber,
      result.primary.qrToken
    );

    const guestResults = (result.guests || []).map((guest) => ({
      ...guest,
      eventPassUrl: buildEventPassUrl(
        eventSlug,
        guest.registrationNumber,
        guest.qrToken
      ),
    }));

    return noStore(
      {
        success: true,
        resultCode: "CLAIMED",
        message: result.message || "Registration completed successfully.",
        attendeeId: result.primary.attendeeId,
        registrationNumber: result.primary.registrationNumber,
        qrToken: result.primary.qrToken,
        eventPassUrl: primaryEventPassUrl,
        ticket: {
          ticketNumber: result.primary.ticketNumber,
          packageName: result.primary.packageName,
          price:
            result.primary.price === null
              ? null
              : Number(result.primary.price),
        },
        guests: guestResults,
      },
      201
    );
  } catch (error) {
    return noStore(
      {
        success: false,
        resultCode: "SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Registration failed.",
      },
      500
    );
  }
}
