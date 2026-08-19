import {
  NextRequest,
  NextResponse,
} from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function noStore(
  body: unknown,
  status = 200
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

async function resolvePassenger(
  req: NextRequest
) {
  const authorization = cleanText(
    req.headers.get("authorization")
  );

  if (
    !authorization
      .toLowerCase()
      .startsWith("bearer ")
  ) {
    return {
      ok: false as const,
      status: 401,
      message:
        "JRide sign-in is required.",
    };
  }

  const token = authorization
    .slice(7)
    .trim();

  if (!token) {
    return {
      ok: false as const,
      status: 401,
      message:
        "JRide sign-in is required.",
    };
  }

  const supabase = supabaseAdmin();
  const { data, error } =
    await supabase.auth.getUser(token);

  if (
    error ||
    !data?.user?.id
  ) {
    return {
      ok: false as const,
      status: 401,
      message:
        "The JRide session is invalid or expired.",
    };
  }

  return {
    ok: true as const,
    userId: data.user.id,
    supabase,
  };
}

function passUrl(
  eventSlug: string,
  registrationNumber: string,
  qrToken: string
) {
  return (
    `/events/${encodeURIComponent(
      eventSlug
    )}/pass/${encodeURIComponent(
      registrationNumber
    )}` +
    `?token=${encodeURIComponent(
      qrToken
    )}`
  );
}

async function audit(
  supabase: any,
  options: {
    eventId: string;
    userId: string;
    attendeeId?: string | null;
    resultCode: string;
  }
) {
  const { error } = await supabase
    .from("event_audit_logs")
    .insert({
      event_id: options.eventId,
      attendee_id:
        options.attendeeId || null,
      actor_id: options.userId,
      action:
        "event_pass_account_recovery",
      details: {
        result_code:
          options.resultCode,
      },
    });

  if (error) {
    console.error(
      "[event-pass-account-recovery-audit]",
      error.message
    );
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
  try {
    const auth =
      await resolvePassenger(req);

    if (!auth.ok) {
      return noStore(
        {
          success: false,
          resultCode: "NOT_AUTHENTICATED",
          message: auth.message,
        },
        auth.status
      );
    }

    const eventSlug = cleanText(
      params.eventSlug
    );

    const { data: event, error: eventError } =
      await auth.supabase
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
      return noStore(
        {
          success: false,
          resultCode: "NOT_FOUND",
          message:
            "No linked Event Pass was found.",
        },
        404
      );
    }

    const { data: attendees, error } =
      await auth.supabase
        .from("event_attendees")
        .select(
          "id,registration_number,qr_token"
        )
        .eq("event_id", event.id)
        .eq(
          "jride_user_id",
          auth.userId
        )
        .eq(
          "registration_status",
          "registered"
        )
        .is("merged_into", null)
        .limit(2);

    if (error) {
      throw new Error(error.message);
    }

    if (
      !Array.isArray(attendees) ||
      attendees.length !== 1
    ) {
      await audit(auth.supabase, {
        eventId: event.id,
        userId: auth.userId,
        resultCode:
          attendees?.length &&
          attendees.length > 1
            ? "MULTIPLE_LINKED_PASSES"
            : "NO_LINKED_PASS",
      });

      return noStore(
        {
          success: false,
          resultCode:
            attendees?.length &&
            attendees.length > 1
              ? "MULTIPLE_LINKED_PASSES"
              : "NO_LINKED_PASS",
          message:
            "No single Event Pass is linked to this JRide account. Use ticket recovery or proceed to the event Help Desk.",
        },
        404
      );
    }

    const attendee = attendees[0];

    await audit(auth.supabase, {
      eventId: event.id,
      userId: auth.userId,
      attendeeId: attendee.id,
      resultCode: "RECOVERED",
    });

    return noStore({
      success: true,
      resultCode: "RECOVERED",
      eventPassUrl: passUrl(
        eventSlug,
        attendee.registration_number,
        attendee.qr_token
      ),
    });
  } catch {
    return noStore(
      {
        success: false,
        resultCode: "SERVER_ERROR",
        message:
          "Unable to recover the Event Pass with this JRide account.",
      },
      500
    );
  }
}