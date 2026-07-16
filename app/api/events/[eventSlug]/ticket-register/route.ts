import { createHmac } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TicketRegistrationRpcRow = {
  success: boolean;
  result_code: string;
  message: string;
  event_id: string | null;
  ticket_id: string | null;
  ticket_number: string | null;
  attendee_id: string | null;
  registration_number: string | null;
  qr_token: string | null;
  package_name: string | null;
  ticket_price: number | string | null;
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
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function getClientIp(req: NextRequest) {
  const forwarded = cleanText(
    req.headers.get("x-forwarded-for")
  );

  if (forwarded) {
    const first = forwarded
      .split(",")[0]
      ?.trim();

    if (first) return first;
  }

  return (
    cleanText(req.headers.get("x-real-ip")) ||
    "unknown"
  );
}

function getRateLimitSecret() {
  return cleanText(
    process.env.JRIDE_EVENT_RATE_LIMIT_SECRET
  );
}

function buildClientKeyHash(req: NextRequest) {
  const secret = getRateLimitSecret();

  if (!secret) {
    throw new Error(
      "JRIDE_EVENT_RATE_LIMIT_SECRET is not configured."
    );
  }

  const ip = getClientIp(req);

  const userAgent = cleanText(
    req.headers.get("user-agent")
  ).slice(0, 500);

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
    case "TICKET_UNAVAILABLE":
    case "EVENT_NOT_OPEN":
    case "REGISTRATION_NOT_STARTED":
    case "REGISTRATION_CLOSED":
      return 409;

    case "EVENT_NOT_FOUND":
      return 404;

    case "INVALID_REQUEST":
    case "INVALID_NAME":
    case "INVALID_MOBILE_NUMBER":
    case "INVALID_CLIENT_KEY":
    case "INVALID_TICKET":
      return 400;

    default:
      return 500;
  }
}

export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: { eventSlug: string };
  }
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

    const body = await req
      .json()
      .catch(() => ({}));

    const ticketNumber = cleanText(
      body.ticketNumber
    ).toUpperCase();

    const claimCode = cleanText(
      body.claimCode
    ).toUpperCase();

    const fullName = cleanText(
      body.fullName
    );

    const mobileNumber = cleanPhone(
      body.mobileNumber
    );

    const nickname = cleanText(
      body.nickname
    );

    if (!ticketNumber || !claimCode) {
      return noStore(
        {
          success: false,
          resultCode: "INVALID_REQUEST",
          message:
            "Ticket number and claim code are required.",
        },
        400
      );
    }

    if (fullName.length < 2) {
      return noStore(
        {
          success: false,
          resultCode: "INVALID_NAME",
          message: "Full name is required.",
        },
        400
      );
    }

    if (
      mobileNumber.length < 10 ||
      mobileNumber.length > 15
    ) {
      return noStore(
        {
          success: false,
          resultCode: "INVALID_MOBILE_NUMBER",
          message:
            "A valid mobile number is required.",
        },
        400
      );
    }

    const clientKeyHash =
      buildClientKeyHash(req);

    const supabase = supabaseAdmin();

    const { data, error } =
      await supabase.rpc(
        "claim_event_ticket_and_register",
        {
          p_event_slug: eventSlug,
          p_ticket_number: ticketNumber,
          p_claim_code: claimCode,
          p_full_name: fullName,
          p_mobile_number: mobileNumber,
          p_nickname: nickname || null,
          p_client_key_hash: clientKeyHash,
        }
      );

    if (error) {
      throw new Error(error.message);
    }

    const row = (
      Array.isArray(data)
        ? data[0]
        : data
    ) as TicketRegistrationRpcRow | null;

    if (!row) {
      throw new Error(
        "Ticket registration returned no result."
      );
    }

    const resultCode = cleanText(
      row.result_code
    );

    if (!row.success) {
      return noStore(
        {
          success: false,
          resultCode,
          message:
            cleanText(row.message) ||
            "Ticket registration failed.",
        },
        statusForResultCode(resultCode)
      );
    }

    if (
      !row.registration_number ||
      !row.qr_token ||
      !row.attendee_id
    ) {
      throw new Error(
        "Registration succeeded but Event Pass details are missing."
      );
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://app.jride.net";

    const eventPassUrl =
      `${appUrl.replace(/\/$/, "")}` +
      `/events/${encodeURIComponent(
        eventSlug
      )}` +
      `/pass/${encodeURIComponent(
        row.registration_number
      )}` +
      `?token=${encodeURIComponent(
        row.qr_token
      )}`;

    return noStore(
      {
        success: true,
        resultCode: "CLAIMED",
        message:
          cleanText(row.message) ||
          "Registration completed successfully.",
        attendeeId: row.attendee_id,
        registrationNumber:
          row.registration_number,
        qrToken: row.qr_token,
        eventPassUrl,
        ticket: {
          ticketId: row.ticket_id,
          ticketNumber:
            row.ticket_number,
          packageName:
            row.package_name,
          price:
            row.ticket_price === null
              ? null
              : Number(row.ticket_price),
        },
      },
      201
    );
  } catch (error) {
    return noStore(
      {
        success: false,
        resultCode: "SERVER_ERROR",
        message:
          error instanceof Error
            ? error.message
            : "Ticket registration failed.",
      },
      500
    );
  }
}