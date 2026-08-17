import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/auth/requireStaff";
import {
  EVENT_NOT_CHECKIN_OPEN_RESPONSE,
  isCheckinOpen,
} from "@/lib/events/checkinLifecycle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(
  _req: Request,
  {
    params,
  }: {
    params: {
      eventSlug: string;
      attendeeId: string;
    };
  }
) {
  try {
    const authorization = await requireStaff(["admin", "dispatcher"]);

    if (!authorization.ok) {
      return noStore(
        {
          success: false,
          reason: authorization.error,
          message:
            authorization.error === "NOT_SIGNED_IN"
              ? "Staff sign-in is required."
              : "You are not allowed to manually check in attendees.",
        },
        authorization.status
      );
    }

    const eventSlug = String(params.eventSlug || "").trim();
    const attendeeId = String(params.attendeeId || "").trim();

    if (!eventSlug || !attendeeId) {
      return noStore(
        {
          success: false,
          reason: "invalid_request",
          message: "Event and attendee are required.",
        },
        400
      );
    }

    const supabase = supabaseAdmin();

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id,slug,status")
      .eq("slug", eventSlug)
      .maybeSingle();

    if (eventError) throw new Error(eventError.message);

    if (!event?.id) {
      return noStore(
        {
          success: false,
          reason: "event_not_found",
          message: "Event was not found.",
        },
        404
      );
    }

    if (!isCheckinOpen(event.status)) {
      return noStore(
        EVENT_NOT_CHECKIN_OPEN_RESPONSE,
        409
      );
    }

    const { data: attendee, error: attendeeError } = await supabase
      .from("event_attendees")
      .select(
        "id,full_name,registration_number,registration_source,attendance_status,checked_in_at,is_disqualified,disqualification_reason,merged_into"
      )
      .eq("event_id", event.id)
      .eq("id", attendeeId)
      .maybeSingle();

    if (attendeeError) throw new Error(attendeeError.message);

    if (!attendee?.id || attendee.merged_into) {
      return noStore(
        {
          success: false,
          reason: "attendee_not_found",
          message: "Attendee was not found for this event.",
        },
        404
      );
    }

    if (attendee.is_disqualified) {
      return noStore(
        {
          success: false,
          reason: "pending_review",
          message:
            attendee.disqualification_reason ||
            "This attendee must be reviewed before check-in.",
        },
        409
      );
    }

    if (attendee.attendance_status === "checked_in") {
      return noStore(
        {
          success: true,
          reason: "already_checked_in",
          attendeeId: attendee.id,
          fullName: attendee.full_name,
          registrationNumber: attendee.registration_number,
          registrationSource: attendee.registration_source,
          attendanceStatus: attendee.attendance_status,
          checkedInAt: attendee.checked_in_at,
          alreadyCheckedIn: true,
          message: "This attendee is already checked in.",
        },
        200
      );
    }

    const now = new Date().toISOString();

    const { data: updated, error: updateError } = await supabase
      .from("event_attendees")
      .update({
        attendance_status: "checked_in",
        checked_in_at: now,
        checked_in_by: null,
        updated_at: now,
      })
      .eq("id", attendee.id)
      .neq("attendance_status", "checked_in")
      .select(
        "id,full_name,registration_number,registration_source,attendance_status,checked_in_at"
      )
      .maybeSingle();

    if (updateError) throw new Error(updateError.message);

    if (!updated?.id) {
      const { data: current, error: currentError } = await supabase
        .from("event_attendees")
        .select(
          "id,full_name,registration_number,registration_source,attendance_status,checked_in_at"
        )
        .eq("id", attendee.id)
        .maybeSingle();

      if (currentError) throw new Error(currentError.message);

      if (current?.attendance_status === "checked_in") {
        return noStore(
          {
            success: true,
            reason: "already_checked_in",
            attendeeId: current.id,
            fullName: current.full_name,
            registrationNumber: current.registration_number,
            registrationSource: current.registration_source,
            attendanceStatus: current.attendance_status,
            checkedInAt: current.checked_in_at,
            alreadyCheckedIn: true,
            message: "This attendee is already checked in.",
          },
          200
        );
      }

      throw new Error("Manual check-in update did not return a row.");
    }

    const { error: logError } = await supabase
      .from("event_checkins")
      .insert({
        event_id: event.id,
        attendee_id: updated.id,
        scanned_by: null,
        station_name: "Help Desk Manual Check-In",
        station_token_id: null,
        checkin_method: "manual",
        checked_in_at: updated.checked_in_at,
      });

    if (logError) {
      console.error(
        "[events/manual-check-in] Check-in audit insert failed:",
        logError.message
      );
    }

    return noStore({
      success: true,
      reason: "checked_in",
      attendeeId: updated.id,
      fullName: updated.full_name,
      registrationNumber: updated.registration_number,
      registrationSource: updated.registration_source,
      attendanceStatus: updated.attendance_status,
      checkedInAt: updated.checked_in_at,
      alreadyCheckedIn: false,
      message: "Attendance recorded manually.",
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        reason: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Manual attendance check-in failed.",
      },
      500
    );
  }
}