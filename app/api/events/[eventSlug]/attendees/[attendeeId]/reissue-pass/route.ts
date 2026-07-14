import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/auth/requireStaff";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  _req: Request,
  { params }: { params: { eventSlug: string; attendeeId: string } }
) {
  try {
    const authorization = await requireStaff(["admin", "dispatcher"]);

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

    const supabase = supabaseAdmin();

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id,slug")
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
      .select("id,registration_number,qr_token,merged_into")
      .eq("id", params.attendeeId)
      .eq("event_id", event.id)
      .maybeSingle();

    if (attendeeError) throw new Error(attendeeError.message);

    if (!attendee?.id || attendee.merged_into) {
      return NextResponse.json(
        { success: false, error: "Attendee not found." },
        { status: 404 }
      );
    }

    if (!attendee.registration_number || !attendee.qr_token) {
      return NextResponse.json(
        { success: false, error: "Event Pass details are missing." },
        { status: 409 }
      );
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://app.jride.net";

    const eventPassUrl = `${appUrl.replace(/\/$/, "")}/events/${encodeURIComponent(
      event.slug
    )}/pass/${encodeURIComponent(attendee.registration_number)}?token=${encodeURIComponent(
      attendee.qr_token
    )}`;

    return NextResponse.json({
      success: true,
      attendeeId: attendee.id,
      registrationNumber: attendee.registration_number,
      eventPassUrl,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Pass reissue failed.",
      },
      { status: 500 }
    );
  }
}
