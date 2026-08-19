import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "crypto";
import {
  NextRequest,
  NextResponse,
} from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const GENERIC_FAILURE =
  "The submitted details could not be verified.";

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function cleanPhone(value: unknown) {
  const digits = String(value ?? "").replace(
    /[^0-9]/g,
    ""
  );

  if (/^09[0-9]{9}$/.test(digits)) {
    return digits;
  }

  if (/^639[0-9]{9}$/.test(digits)) {
    return "0" + digits.slice(2);
  }

  if (/^9[0-9]{9}$/.test(digits)) {
    return "0" + digits;
  }

  return "";
}

function normalizeTicketNumber(value: unknown) {
  const compact = cleanText(value)
    .toUpperCase()
    .replace(/\s+/g, "");

  if (/^[0-9]{1,4}$/.test(compact)) {
    return `FR-${compact.padStart(3, "0")}`;
  }

  const match = compact.match(
    /^(FR|SP)-?([0-9]{1,4})$/
  );

  if (!match) {
    return "";
  }

  return `${match[1]}-${match[2].padStart(
    3,
    "0"
  )}`;
}

function clientIp(req: NextRequest) {
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
    cleanText(
      req.headers.get("x-real-ip")
    ) || "unknown"
  );
}

function rateLimitSecret() {
  const secret = cleanText(
    process.env.JRIDE_EVENT_RATE_LIMIT_SECRET
  );

  if (!secret) {
    throw new Error(
      "JRIDE_EVENT_RATE_LIMIT_SECRET is not configured."
    );
  }

  return secret;
}

function hmac(secret: string, value: string) {
  return createHmac("sha256", secret)
    .update(value, "utf8")
    .digest("hex");
}

function hashClaimCode(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function safeHexEqual(
  expected: unknown,
  actual: string
) {
  const expectedText = cleanText(expected)
    .toLowerCase();

  if (
    !/^[0-9a-f]{64}$/.test(expectedText) ||
    !/^[0-9a-f]{64}$/.test(actual)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(expectedText, "hex"),
    Buffer.from(actual, "hex")
  );
}

function redirectBack(
  req: NextRequest,
  eventSlug: string,
  result: "failed" | "rate_limited"
) {
  const url = new URL(
    `/events/${encodeURIComponent(
      eventSlug
    )}/my-walk`,
    req.url
  );

  url.searchParams.set("recovery", result);

  const response =
    NextResponse.redirect(url, 303);

  response.headers.set(
    "Cache-Control",
    "no-store"
  );

  return response;
}

async function attemptCount(
  supabase: any,
  options: {
    eventId: string;
    sinceIso: string;
    detailKey:
      | "client_key_hash"
      | "recovery_key_hash";
    detailValue: string;
  }
) {
  const { count, error } = await supabase
    .from("event_audit_logs")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("event_id", options.eventId)
    .eq(
      "action",
      "event_pass_recovery_attempt"
    )
    .gte("created_at", options.sinceIso)
    .contains("details", {
      [options.detailKey]:
        options.detailValue,
    });

  if (error) {
    throw new Error(error.message);
  }

  return count || 0;
}

async function recordAttempt(
  supabase: any,
  options: {
    eventId: string;
    attendeeId?: string | null;
    clientKeyHash: string;
    recoveryKeyHash: string;
    resultCode: string;
    succeeded: boolean;
  }
) {
  const { error } = await supabase
    .from("event_audit_logs")
    .insert({
      event_id: options.eventId,
      attendee_id:
        options.attendeeId || null,
      actor_id: null,
      action:
        "event_pass_recovery_attempt",
      details: {
        client_key_hash:
          options.clientKeyHash,
        recovery_key_hash:
          options.recoveryKeyHash,
        result_code: options.resultCode,
        succeeded: options.succeeded,
      },
    });

  if (error) {
    throw new Error(error.message);
  }
}

export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: {
      eventSlug: string;
    };
  }
) {
  const eventSlug = cleanText(
    params.eventSlug
  );

  try {
    const form = await req.formData();

    const ticketNumber =
      normalizeTicketNumber(
        form.get("ticketNumber")
      );
    const claimCode = cleanText(
      form.get("claimCode")
    ).toUpperCase();
    const mobileNumber = cleanPhone(
      form.get("mobileNumber")
    );

    const secret = rateLimitSecret();
    const userAgent = cleanText(
      req.headers.get("user-agent")
    ).slice(0, 500);

    const clientKeyHash = hmac(
      secret,
      `${clientIp(req)}|${userAgent}`
    );

    const recoveryKeyHash = hmac(
      secret,
      `${eventSlug}|${
        ticketNumber ||
        cleanText(
          form.get("ticketNumber")
        ).toUpperCase()
      }|${mobileNumber}`
    );

    const supabase = supabaseAdmin();

    const { data: event, error: eventError } =
      await supabase
        .from("events")
        .select("id,slug,status")
        .eq("slug", eventSlug)
        .in("status", [
          "published",
          "registration_open",
          "registration_closed",
          "live",
          "completed",
        ])
        .maybeSingle();

    if (eventError) {
      throw new Error(eventError.message);
    }

    if (!event?.id) {
      return redirectBack(
        req,
        eventSlug,
        "failed"
      );
    }

    const now = Date.now();
    const tenMinutesAgo = new Date(
      now - 10 * 60 * 1000
    ).toISOString();
    const oneDayAgo = new Date(
      now - 24 * 60 * 60 * 1000
    ).toISOString();

    const [
      clientTenMinuteCount,
      recoveryTenMinuteCount,
      clientDailyCount,
    ] = await Promise.all([
      attemptCount(supabase, {
        eventId: event.id,
        sinceIso: tenMinutesAgo,
        detailKey: "client_key_hash",
        detailValue: clientKeyHash,
      }),
      attemptCount(supabase, {
        eventId: event.id,
        sinceIso: tenMinutesAgo,
        detailKey:
          "recovery_key_hash",
        detailValue: recoveryKeyHash,
      }),
      attemptCount(supabase, {
        eventId: event.id,
        sinceIso: oneDayAgo,
        detailKey: "client_key_hash",
        detailValue: clientKeyHash,
      }),
    ]);

    if (
      clientTenMinuteCount >= 5 ||
      recoveryTenMinuteCount >= 5 ||
      clientDailyCount >= 20
    ) {
      return redirectBack(
        req,
        eventSlug,
        "rate_limited"
      );
    }

    const invalidInput =
      !ticketNumber ||
      claimCode.length < 8 ||
      claimCode.length > 64 ||
      !mobileNumber;

    if (invalidInput) {
      await recordAttempt(supabase, {
        eventId: event.id,
        clientKeyHash,
        recoveryKeyHash,
        resultCode: "INVALID",
        succeeded: false,
      });

      return redirectBack(
        req,
        eventSlug,
        "failed"
      );
    }

    const { data: ticket, error: ticketError } =
      await supabase
        .from("event_tickets")
        .select(
          "id,status,claim_code_hash,claimed_attendee_id"
        )
        .eq("event_id", event.id)
        .eq(
          "ticket_number",
          ticketNumber
        )
        .maybeSingle();

    if (ticketError) {
      throw new Error(ticketError.message);
    }

    let attendee: any = null;

    if (
      ticket?.status === "claimed" &&
      ticket.claimed_attendee_id
    ) {
      const attendeeResult = await supabase
        .from("event_attendees")
        .select(
          "id,registration_number,qr_token,mobile_number,registration_status,merged_into"
        )
        .eq(
          "event_id",
          event.id
        )
        .eq(
          "id",
          ticket.claimed_attendee_id
        )
        .maybeSingle();

      if (attendeeResult.error) {
        throw new Error(
          attendeeResult.error.message
        );
      }

      attendee = attendeeResult.data;
    }

    const codeMatches = safeHexEqual(
      ticket?.claim_code_hash,
      hashClaimCode(claimCode)
    );

    const mobileMatches =
      attendee &&
      cleanPhone(attendee.mobile_number) ===
        mobileNumber;

    const valid =
      Boolean(attendee?.id) &&
      attendee.registration_status ===
        "registered" &&
      !attendee.merged_into &&
      codeMatches &&
      mobileMatches;

    if (!valid) {
      await recordAttempt(supabase, {
        eventId: event.id,
        clientKeyHash,
        recoveryKeyHash,
        resultCode: GENERIC_FAILURE,
        succeeded: false,
      });

      return redirectBack(
        req,
        eventSlug,
        "failed"
      );
    }

    await recordAttempt(supabase, {
      eventId: event.id,
      attendeeId: attendee.id,
      clientKeyHash,
      recoveryKeyHash,
      resultCode: "RECOVERED",
      succeeded: true,
    });

    const passUrl = new URL(
      `/events/${encodeURIComponent(
        eventSlug
      )}/pass/${encodeURIComponent(
        attendee.registration_number
      )}`,
      req.url
    );

    passUrl.searchParams.set(
      "token",
      attendee.qr_token
    );

    const response =
      NextResponse.redirect(passUrl, 303);

    response.headers.set(
      "Cache-Control",
      "no-store"
    );

    return response;
  } catch {
    return redirectBack(
      req,
      eventSlug,
      "failed"
    );
  }
}