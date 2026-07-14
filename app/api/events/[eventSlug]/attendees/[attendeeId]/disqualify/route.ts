import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/auth/requireStaff";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanText(value: unknown) {
  return String(value || "").trim();
}

export async function POST(
  req: NextRequest,
  { params }: { params: { eventSlug: string; attendeeId: string } }
) {
  try {
    const authorization = await requireStaff(["admin"]);

    if (!authorization.ok) {
      return NextResponse.json(
        {
          success: false,
          error: authorization.error,
        },
        {
          status: authorization.status,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const body = await req.json();

    const disqualified =
      body.disqualified === true || body.disqualified === false
        ? Boolean(body.disqualified)
        : null;

    if (disqualified === null) {
      return NextResponse.json(
        { success: false, error: "disqualified must be true or false." },
        { status: 400 }
      );
    }

    const reason = cleanText(body.reason);

    if (disqualified && !reason) {
      return NextResponse.json(
        { success: false, error: "A reason is required when disqualifying an attendee." },
        { status: 400 }
      );
    }

    const supabase = supabaseAdmin();

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id")
      .eq("slug", params.eventSlug)
      .maybeSingle();

    if (eventError) throw new Error(eventError.message);

    if (!event?.id) {
      return NextResponse.json(
        { success: false, error: "Event not found." },
        { status: 404 }
      );
    }

    const { data: attendee, error: attendeeError } = await supabase
      .from("event_attendees")
      .select("id,full_name,registration_number,is_disqualified,merged_into")
      .eq("id", params.attendeeId)
      .eq("event_id", event.id)
      .is("merged_into", null)
      .maybeSingle();

    if (attendeeError) throw new Error(attendeeError.message);

    if (!attendee?.id) {
      return NextResponse.json(
        { success: false, error: "Attendee not found." },
        { status: 404 }
      );
    }

    if (attendee.is_disqualified === disqualified) {
      return NextResponse.json({
        success: true,
        attendeeId: attendee.id,
        registrationNumber: attendee.registration_number,
        fullName: attendee.full_name,
        isDisqualified: attendee.is_disqualified,
        noChange: true,
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from("event_attendees")
      .update({
        is_disqualified: disqualified,
        disqualification_reason: disqualified ? reason : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", attendee.id)
      .select("id,registration_number,full_name,is_disqualified,disqualification_reason")
      .single();

    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({
      success: true,
      attendeeId: updated.id,
      registrationNumber: updated.registration_number,
      fullName: updated.full_name,
      isDisqualified: updated.is_disqualified,
      disqualificationReason: updated.disqualification_reason,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Disqualification update failed.",
      },
      { status: 500 }
    );
  }
}
