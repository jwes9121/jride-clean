import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function cleanPhone(value: unknown) {
  return String(value || "").replace(/[^0-9]/g, "");
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { eventSlug: string; attendeeId: string } }
) {
  try {
    const body = await req.json();

    const fullName = cleanText(body.fullName);
    const mobileNumber = cleanPhone(body.mobileNumber);
    const nickname = cleanText(body.nickname);
    const groupValue = cleanText(body.groupValue);

    if (fullName.length < 2) {
      return NextResponse.json(
        {
          success: false,
          error: "Full name is required.",
        },
        { status: 400 }
      );
    }

    if (mobileNumber.length < 10) {
      return NextResponse.json(
        {
          success: false,
          error: "Valid mobile number is required.",
        },
        { status: 400 }
      );
    }

    if (!groupValue) {
      return NextResponse.json(
        {
          success: false,
          error: "Group value is required.",
        },
        { status: 400 }
      );
    }

    const supabase = supabaseAdmin();

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id,slug,group_label")
      .eq("slug", params.eventSlug)
      .maybeSingle();

    if (eventError) throw new Error(eventError.message);

    if (!event?.id) {
      return NextResponse.json(
        {
          success: false,
          error: "Event not found.",
        },
        { status: 404 }
      );
    }

    const { data: attendee, error: attendeeError } = await supabase
      .from("event_attendees")
      .select("id,event_id")
      .eq("id", params.attendeeId)
      .eq("event_id", event.id)
      .is("merged_into", null)
      .maybeSingle();

    if (attendeeError) throw new Error(attendeeError.message);

    if (!attendee?.id) {
      return NextResponse.json(
        {
          success: false,
          error: "Attendee not found.",
        },
        { status: 404 }
      );
    }

    const { data: groupRow, error: groupError } = await supabase
      .from("event_group_values")
      .select("id")
      .eq("event_id", event.id)
      .eq("value", groupValue)
      .maybeSingle();

    if (groupError) throw new Error(groupError.message);

    if (!groupRow?.id) {
      return NextResponse.json(
        {
          success: false,
          error: `${event.group_label || "Group"} is invalid.`,
        },
        { status: 400 }
      );
    }

    const { data: duplicate, error: duplicateError } = await supabase
      .from("event_attendees")
      .select("id,full_name,registration_number")
      .eq("event_id", event.id)
      .eq("mobile_number", mobileNumber)
      .neq("id", attendee.id)
      .is("merged_into", null)
      .limit(1)
      .maybeSingle();

    if (duplicateError) throw new Error(duplicateError.message);

    if (duplicate?.id) {
      return NextResponse.json(
        {
          success: false,
          error: `Mobile number is already registered to ${duplicate.full_name} (${duplicate.registration_number}).`,
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();

    const { data: updated, error: updateError } = await supabase
      .from("event_attendees")
      .update({
        full_name: fullName,
        mobile_number: mobileNumber,
        nickname: nickname || null,
        group_value: groupValue,
        updated_at: now,
      })
      .eq("id", attendee.id)
      .select(
        "id,full_name,mobile_number,nickname,group_value,registration_number,registration_status,attendance_status,checked_in_at,is_disqualified,disqualification_reason"
      )
      .single();

    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({
      success: true,
      attendee: {
        attendeeId: updated.id,
        fullName: updated.full_name,
        mobileNumber: updated.mobile_number,
        nickname: updated.nickname,
        groupValue: updated.group_value,
        registrationNumber: updated.registration_number,
        registrationStatus: updated.registration_status,
        attendanceStatus: updated.attendance_status,
        checkedInAt: updated.checked_in_at,
        isDisqualified: updated.is_disqualified,
        disqualificationReason: updated.disqualification_reason,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Attendee update failed.",
      },
      { status: 500 }
    );
  }
}
