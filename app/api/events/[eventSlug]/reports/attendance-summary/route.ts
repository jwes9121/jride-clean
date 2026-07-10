import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AttendeeRow = {
  id: string;
  attendee_type_id: string;
  full_name: string;
  mobile_number: string | null;
  group_value: string | null;
  registration_number: string;
  registration_source: string | null;
  registration_status: string | null;
  attendance_status: string | null;
  registered_at: string | null;
  checked_in_at: string | null;
  is_disqualified: boolean | null;
};

type RaffleWinnerRow = {
  id: string;
  status: string;
  claimed_at: string | null;
  attendee:
    | {
        id: string;
        full_name: string;
        group_value: string | null;
        registration_number: string;
      }
    | {
        id: string;
        full_name: string;
        group_value: string | null;
        registration_number: string;
      }[]
    | null;
  draw:
    | {
        id: string;
        draw_name: string;
        draw_type: string;
      }
    | {
        id: string;
        draw_name: string;
        draw_type: string;
      }[]
    | null;
};

function firstRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] || null : value;
}

function isCheckedIn(row: AttendeeRow) {
  return row.attendance_status === "checked_in";
}

function isDisqualified(row: AttendeeRow) {
  return row.is_disqualified === true;
}

function isAbsent(row: AttendeeRow) {
  return !isCheckedIn(row) && !isDisqualified(row);
}

export async function GET(
  _req: Request,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const supabase = supabaseAdmin();

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id,name,short_name,slug,event_date,venue,group_label,status")
      .eq("slug", params.eventSlug)
      .maybeSingle();

    if (eventError) throw new Error(eventError.message);

    if (!event?.id) {
      return NextResponse.json(
        { success: false, error: "Event not found." },
        { status: 404 }
      );
    }

    const { data: attendeeTypes, error: typeError } = await supabase
      .from("event_attendee_types")
      .select("id,type_key")
      .eq("event_id", event.id);

    if (typeError) throw new Error(typeError.message);

    const alumniTypeId =
      (attendeeTypes || []).find((row) => row.type_key === "alumni")?.id || null;

    const guestTypeId =
      (attendeeTypes || []).find((row) => row.type_key === "guest")?.id || null;

    if (!alumniTypeId) {
      return NextResponse.json(
        { success: false, error: "Alumni attendee type not found." },
        { status: 500 }
      );
    }

    const [attendeesResult, raffleResult] = await Promise.all([
      supabase
        .from("event_attendees")
        .select(
          "id,attendee_type_id,full_name,mobile_number,group_value,registration_number,registration_source,registration_status,attendance_status,registered_at,checked_in_at,is_disqualified"
        )
        .eq("event_id", event.id)
        .is("merged_into", null)
        .order("group_value", { ascending: true })
        .order("full_name", { ascending: true }),

      supabase
        .from("event_raffle_winners")
        .select(
          "id,status,claimed_at,attendee:event_attendees!event_raffle_winners_attendee_id_fkey(id,full_name,group_value,registration_number),draw:event_raffle_draws!event_raffle_winners_draw_id_fkey(id,draw_name,draw_type)"
        )
        .eq("event_id", event.id)
        .order("created_at", { ascending: false }),
    ]);

    if (attendeesResult.error) {
      throw new Error(attendeesResult.error.message);
    }

    if (raffleResult.error) {
      throw new Error(raffleResult.error.message);
    }

    const attendees = (attendeesResult.data || []) as AttendeeRow[];

    const alumni = attendees.filter(
      (row) => row.attendee_type_id === alumniTypeId
    );

    const guests = guestTypeId
      ? attendees.filter((row) => row.attendee_type_id === guestTypeId)
      : [];

    const alumniCheckedIn = alumni.filter(isCheckedIn);
    const guestCheckedIn = guests.filter(isCheckedIn);

    const alumniAbsent = alumni.filter(isAbsent);
    const guestAbsent = guests.filter(isAbsent);

    const disqualified = attendees.filter(isDisqualified);

    const batchMap = new Map<
      string,
      {
        groupValue: string;
        registered: number;
        checkedIn: number;
        absent: number;
        disqualified: number;
      }
    >();

    for (const attendee of alumni) {
      const groupValue = String(attendee.group_value || "Unknown");

      const current = batchMap.get(groupValue) || {
        groupValue,
        registered: 0,
        checkedIn: 0,
        absent: 0,
        disqualified: 0,
      };

      current.registered += 1;

      if (isCheckedIn(attendee)) {
        current.checkedIn += 1;
      } else if (isDisqualified(attendee)) {
        current.disqualified += 1;
      } else {
        current.absent += 1;
      }

      batchMap.set(groupValue, current);
    }

    const batchSummary = Array.from(batchMap.values()).sort((a, b) =>
      a.groupValue.localeCompare(b.groupValue, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );

    const totalRegistered = alumni.length + guests.length;
    const totalCheckedIn = alumniCheckedIn.length + guestCheckedIn.length;

    const attendanceRate =
      totalRegistered > 0
        ? Number(((totalCheckedIn / totalRegistered) * 100).toFixed(2))
        : 0;

    const absentees = [...alumniAbsent, ...guestAbsent]
      .sort((a, b) => {
        const batchCompare = String(a.group_value || "").localeCompare(
          String(b.group_value || ""),
          undefined,
          { numeric: true, sensitivity: "base" }
        );

        if (batchCompare !== 0) return batchCompare;

        return a.full_name.localeCompare(b.full_name, undefined, {
          sensitivity: "base",
        });
      })
      .map((row) => ({
        attendeeId: row.id,
        attendeeType:
          row.attendee_type_id === alumniTypeId ? "alumni" : "guest",
        fullName: row.full_name,
        mobileNumber: row.mobile_number,
        groupValue: row.group_value,
        registrationNumber: row.registration_number,
        registrationSource: row.registration_source,
        registeredAt: row.registered_at,
      }));

    const raffleWinners = (
      (raffleResult.data || []) as RaffleWinnerRow[]
    ).map((row) => {
      const attendee = firstRelation(row.attendee);
      const draw = firstRelation(row.draw);

      return {
        winnerId: row.id,
        status: row.status,
        claimedAt: row.claimed_at,
        draw: draw
          ? {
              drawId: draw.id,
              drawName: draw.draw_name,
              drawType: draw.draw_type,
            }
          : null,
        attendee: attendee
          ? {
              attendeeId: attendee.id,
              fullName: attendee.full_name,
              groupValue: attendee.group_value,
              registrationNumber: attendee.registration_number,
            }
          : null,
      };
    });

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      event: {
        eventId: event.id,
        title: event.name,
        shortName: event.short_name,
        slug: event.slug,
        eventDate: event.event_date,
        venue: event.venue,
        groupLabel: event.group_label || "Batch",
        status: event.status,
      },
      summary: {
        alumni: {
          registered: alumni.length,
          checkedIn: alumniCheckedIn.length,
          absent: alumniAbsent.length,
        },
        guests: {
          registered: guests.length,
          checkedIn: guestCheckedIn.length,
          absent: guestAbsent.length,
        },
        total: {
          registered: totalRegistered,
          checkedIn: totalCheckedIn,
          absent: alumniAbsent.length + guestAbsent.length,
          disqualified: disqualified.length,
          attendanceRate,
        },
      },
      batchSummary,
      absentees,
      raffleWinners,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Attendance report failed to load.",
      },
      { status: 500 }
    );
  }
}
