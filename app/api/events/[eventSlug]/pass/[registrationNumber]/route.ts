import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: NextRequest,
  { params }: { params: { eventSlug: string; registrationNumber: string } }
) {
  try {
    const token = String(req.nextUrl.searchParams.get("token") || "").trim();

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Pass token is required." },
        { status: 401 }
      );
    }

    const supabase = supabaseAdmin();

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id,slug,name,short_name,event_date,venue,group_label")
      .eq("slug", params.eventSlug)
      .eq("status", "published")
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
      .select("id,full_name,nickname,group_value,registration_number,qr_token,attendance_status,checked_in_at,is_disqualified,disqualification_reason")
      .eq("event_id", event.id)
      .eq("registration_number", decodeURIComponent(params.registrationNumber))
      .eq("qr_token", token)
      .is("merged_into", null)
      .maybeSingle();

    if (attendeeError) throw new Error(attendeeError.message);

    if (!attendee?.id) {
      return NextResponse.json(
        { success: false, error: "Event pass not found or token is invalid." },
        { status: 404 }
      );
    }

    const { data: links, error: guestError } = await supabase
      .from("event_guest_links")
      .select("relationship,guest:event_attendees!event_guest_links_guest_attendee_id_fkey(id,full_name,registration_number,attendance_status)")
      .eq("event_id", event.id)
      .eq("primary_attendee_id", attendee.id)
      .order("created_at", { ascending: true });

    if (guestError) throw new Error(guestError.message);

    return NextResponse.json({
      success: true,
      event,
      attendee,
      guests: links || [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load event pass.",
      },
      { status: 500 }
    );
  }
}