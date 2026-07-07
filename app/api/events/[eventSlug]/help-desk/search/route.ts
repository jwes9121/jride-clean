import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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

function cleanQuery(value: string | null) {
  return String(value || "").trim();
}

function cleanPhone(value: string) {
  return value.replace(/[^0-9]/g, "");
}

export async function GET(
  req: NextRequest,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const q = cleanQuery(req.nextUrl.searchParams.get("q"));

    if (q.length < 2) {
      return NextResponse.json(
        {
          success: false,
          error: "Search query must be at least 2 characters.",
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

    const phone = cleanPhone(q);
    const escaped = q.replace(/[%_]/g, "\\$&");

    const filters = [
      `registration_number.ilike.%${escaped}%`,
      `full_name.ilike.%${escaped}%`,
      `nickname.ilike.%${escaped}%`,
    ];

    if (phone.length >= 4) {
      filters.push(`mobile_number.ilike.%${phone}%`);
    }

    const { data: attendees, error: attendeeError } = await supabase
      .from("event_attendees")
      .select(
        "id,full_name,mobile_number,nickname,group_value,registration_number,qr_token,registration_status,attendance_status,checked_in_at,is_disqualified,disqualification_reason,merged_into"
      )
      .eq("event_id", event.id)
      .is("merged_into", null)
      .or(filters.join(","))
      .order("reg_sequence", { ascending: false })
      .limit(20);

    if (attendeeError) throw new Error(attendeeError.message);

    const rows = attendees || [];
    const primaryIds = rows.map((row) => row.id);

    let guestsByPrimary = new Map<string, ReturnType<typeof normalizeGuests>>();

    if (primaryIds.length > 0) {
      const { data: guestRows, error: guestError } = await supabase
        .from("event_guest_links")
        .select(
          "primary_attendee_id,relationship,guest:event_attendees!event_guest_links_guest_attendee_id_fkey(id,full_name,registration_number,attendance_status)"
        )
        .eq("event_id", event.id)
        .in("primary_attendee_id", primaryIds)
        .order("created_at", { ascending: true });

      if (guestError) throw new Error(guestError.message);

      guestsByPrimary = new Map();

      for (const row of (guestRows || []) as (GuestLinkRow & { primary_attendee_id: string })[]) {
        const current = guestsByPrimary.get(row.primary_attendee_id) || [];
        guestsByPrimary.set(row.primary_attendee_id, [
          ...current,
          ...normalizeGuests([row]),
        ]);
      }
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://app.jride.net";

    return NextResponse.json({
      success: true,
      eventSlug: event.slug,
      groupLabel: event.group_label || "Group",
      count: rows.length,
      results: rows.map((attendee) => ({
        attendeeId: attendee.id,
        fullName: attendee.full_name,
        mobileNumber: attendee.mobile_number,
        nickname: attendee.nickname,
        groupValue: attendee.group_value,
        registrationNumber: attendee.registration_number,
        registrationStatus: attendee.registration_status,
        attendanceStatus: attendee.attendance_status,
        checkedInAt: attendee.checked_in_at,
        isDisqualified: attendee.is_disqualified,
        disqualificationReason: attendee.disqualification_reason,
        eventPassUrl: `${appUrl.replace(/\/$/, "")}/events/${encodeURIComponent(
          event.slug
        )}/pass/${encodeURIComponent(attendee.registration_number)}?token=${encodeURIComponent(
          attendee.qr_token
        )}`,
        guests: guestsByPrimary.get(attendee.id) || [],
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Help Desk search failed.",
      },
      { status: 500 }
    );
  }
}
