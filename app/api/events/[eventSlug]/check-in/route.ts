import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  EVENT_NOT_CHECKIN_OPEN_RESPONSE,
  isCheckinOpen,
} from "@/lib/events/checkinLifecycle";
import { requireEventStation } from "@/lib/events/requireEventStation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type GuestLinkRow = {
  relationship: string;
  guest:
    | {
        id: string;
        full_name: string;
        registration_number: string;
        attendance_status: string;
      }
    | {
        id: string;
        full_name: string;
        registration_number: string;
        attendance_status: string;
      }[]
    | null;
};

function normalizeGuests(rows: GuestLinkRow[]) {
  return rows
    .map((row) => {
      const guest = Array.isArray(row.guest) ? row.guest[0] : row.guest;
      if (!guest) return null;

      return {
        attendeeId: guest.id,
        fullName: guest.full_name,
        registrationNumber: guest.registration_number,
        attendanceStatus: guest.attendance_status,
        relationship: row.relationship,
      };
    })
    .filter(Boolean);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const stationToken = String(
      req.headers.get("x-event-station-token") || ""
    ).trim();

    const supabase = supabaseAdmin();

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id,slug,group_label,status")
      .eq("slug", params.eventSlug)
      .maybeSingle();

    if (eventError) throw new Error(eventError.message);

    if (!event?.id) {
      return NextResponse.json(
        {
          success: false,
          reason: "invalid_token",
          message: "Event Pass is invalid.",
        },
        { status: 404 }
      );
    }

    const stationAuthorization =
      await requireEventStation(
        supabase,
        event.id,
        stationToken,
        "scanner"
      );

    if (!stationAuthorization.ok) {
      return NextResponse.json(
        {
          success: false,
          reason: "station_auth_required",
          message:
            stationAuthorization.error === "STATION_TOKEN_REQUIRED"
              ? "Scanner station authorization is required."
              : "Scanner station token is invalid, expired, or revoked.",
        },
        {
          status: stationAuthorization.status,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    if (!isCheckinOpen(event.status)) {
      return NextResponse.json(
        EVENT_NOT_CHECKIN_OPEN_RESPONSE,
        {
          status: 409,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const body = await req.json().catch(() => ({}));

    const registrationNumber = String(
      body.registrationNumber || ""
    ).trim();

    const qrToken = String(body.qrToken || "").trim();

    if (!registrationNumber || !qrToken) {
      return NextResponse.json(
        {
          success: false,
          reason: "invalid_request",
          message: "Registration number and QR token are required.",
        },
        { status: 400 }
      );
    }

    const { data: attendee, error: attendeeError } = await supabase
      .from("event_attendees")
      .select(
        "id,full_name,group_value,registration_number,qr_token,attendance_status,checked_in_at,is_disqualified,disqualification_reason,merged_into"
      )
      .eq("event_id", event.id)
      .eq("registration_number", registrationNumber)
      .eq("qr_token", qrToken)
      .maybeSingle();

    if (attendeeError) throw new Error(attendeeError.message);

    if (!attendee?.id || attendee.merged_into) {
      return NextResponse.json(
        {
          success: false,
          reason: "invalid_token",
          message: "Event Pass is invalid.",
        },
        { status: 404 }
      );
    }

    if (attendee.is_disqualified) {
      return NextResponse.json(
        {
          success: false,
          reason: "pending_review",
          attendeeId: attendee.id,
          fullName: attendee.full_name,
          registrationNumber: attendee.registration_number,
          groupValue: attendee.group_value,
          groupLabel: event.group_label || "Group",
          message: attendee.disqualification_reason || "Please proceed to the Help Desk.",
        },
        { status: 409 }
      );
    }

    if (attendee.attendance_status === "checked_in") {
      return NextResponse.json(
        {
          success: false,
          reason: "already_checked_in",
          attendeeId: attendee.id,
          fullName: attendee.full_name,
          registrationNumber: attendee.registration_number,
          groupValue: attendee.group_value,
          groupLabel: event.group_label || "Group",
          checkedInAt: attendee.checked_in_at,
          message: "This Event Pass has already been checked in.",
        },
        { status: 409 }
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
        "id,full_name,group_value,registration_number,attendance_status,checked_in_at"
      )
      .maybeSingle();

    if (updateError) throw new Error(updateError.message);

    if (!updated?.id) {
      const { data: currentAttendee, error: currentError } = await supabase
        .from("event_attendees")
        .select(
          "id,full_name,group_value,registration_number,attendance_status,checked_in_at"
        )
        .eq("id", attendee.id)
        .maybeSingle();

      if (currentError) throw new Error(currentError.message);

      if (currentAttendee?.attendance_status === "checked_in") {
        return NextResponse.json(
          {
            success: false,
            reason: "already_checked_in",
            attendeeId: currentAttendee.id,
            fullName: currentAttendee.full_name,
            registrationNumber: currentAttendee.registration_number,
            groupValue: currentAttendee.group_value,
            groupLabel: event.group_label || "Group",
            checkedInAt: currentAttendee.checked_in_at,
            message: "This Event Pass has already been checked in.",
          },
          { status: 409 }
        );
      }

      throw new Error("Check-in update did not return a row.");
    }

    const { error: checkinLogError } = await supabase
      .from("event_checkins")
      .insert({
        event_id: event.id,
        attendee_id: updated.id,
        scanned_by: null,
        station_name: stationAuthorization.station.stationName,
        station_token_id: stationAuthorization.station.id,
        checkin_method: "qr",
        checked_in_at: updated.checked_in_at,
      });

    if (checkinLogError) {
      console.error(
        "[events/check-in] Check-in audit insert failed:",
        checkinLogError.message
      );
    }

    const { data: guestRows, error: guestError } = await supabase
      .from("event_guest_links")
      .select(
        "relationship,guest:event_attendees!event_guest_links_guest_attendee_id_fkey(id,full_name,registration_number,attendance_status)"
      )
      .eq("event_id", event.id)
      .eq("primary_attendee_id", attendee.id)
      .order("created_at", { ascending: true })
      .returns<GuestLinkRow[]>();

    if (guestError) throw new Error(guestError.message);

    return NextResponse.json({
      success: true,
      reason: "checked_in",
      attendeeId: updated.id,
      fullName: updated.full_name,
      registrationNumber: updated.registration_number,
      groupValue: updated.group_value,
      groupLabel: event.group_label || "Group",
      status: updated.attendance_status,
      checkedInAt: updated.checked_in_at,
      guests: normalizeGuests(guestRows || []),
      message: "Checked in successfully.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        reason: "server_error",
        message: error instanceof Error ? error.message : "Check-in failed.",
      },
      { status: 500 }
    );
  }
}

