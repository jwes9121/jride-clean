// app/api/events/[eventSlug]/help-desk/register/route.ts
//
// Walk-in registration endpoint for Help Desk and Registration.
// Reuses the shared registration engine.
//
// Walk-in behavior:
//   1. Register with registration_source = "walk_in".
//   2. Immediately check in the primary attendee and registered companions.
//   3. Return the canonical event-specific Event Pass URL.
//
// registeredBy and checked_in_by are intentionally omitted until the
// Help Desk is backed by an authenticated staff UUID.

import { NextRequest, NextResponse } from "next/server";
import { registerAttendee } from "@/lib/events/registration";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/auth/requireStaff";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://app.jride.net";

export async function POST(
  req: NextRequest,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const authorization = await requireStaff(["admin", "dispatcher"]);

    if (!authorization.ok) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: authorization.error,
            message:
              authorization.error === "NOT_SIGNED_IN"
                ? "Staff sign-in is required."
                : "You are not allowed to use Help Desk registration.",
          },
        },
        {
          status: authorization.status,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const body = await req.json().catch(() => ({}));
    const eventSlug = String(params?.eventSlug || "").trim();

    if (!eventSlug) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_PARAMS",
            message: "Event slug is required.",
          },
        },
        { status: 400 }
      );
    }

    const supabase = supabaseAdmin();

    const result = await registerAttendee(
      supabase,
      {
        eventSlug,
        fullName: body.fullName ?? "",
        mobileNumber: body.mobileNumber ?? "",
        groupValue: body.groupValue ?? "",
        nickname: body.nickname ?? "",
        guests: Array.isArray(body.guests) ? body.guests : [],
      },
      {
        source: "walk_in",
      }
    );

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    const attendeeIds = [
      result.attendeeId,
      ...(result.guests || []).map((guest) => guest.attendeeId),
    ].filter((value): value is string => Boolean(value));

    const checkedInAt = new Date().toISOString();
    let checkInSucceeded = false;
    let checkInErrorMessage: string | null = null;

    if (attendeeIds.length > 0) {
      const { error: checkInError } = await supabase
        .from("event_attendees")
        .update({
          attendance_status: "checked_in",
          checked_in_at: checkedInAt,
        })
        .in("id", attendeeIds);

      checkInSucceeded = !checkInError;
      checkInErrorMessage = checkInError?.message || null;

      if (checkInError) {
        console.error(
          "[help-desk/register] Immediate check-in failed:",
          checkInError.message
        );
      }
    }

    const registrationNumber = result.registrationNumber || "";
    const qrToken = result.qrToken || "";

    const eventPassUrl =
      registrationNumber && qrToken
        ? `${APP_URL}/events/${encodeURIComponent(
            eventSlug
          )}/pass/${encodeURIComponent(
            registrationNumber
          )}?token=${encodeURIComponent(qrToken)}`
        : result.eventPassUrl;

    return NextResponse.json({
      ...result,
      eventPassUrl,
      checkedIn: checkInSucceeded,
      checkedInAt: checkInSucceeded ? checkedInAt : null,
      checkedInAttendeeCount: checkInSucceeded ? attendeeIds.length : 0,
      checkInError: checkInSucceeded ? null : checkInErrorMessage,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Registration failed.",
        },
      },
      { status: 500 }
    );
  }
}
