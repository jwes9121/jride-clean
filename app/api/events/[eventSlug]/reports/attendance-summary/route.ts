import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/auth/requireStaff";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AttendeeTypeRow = {
  id: string;
  type_key: string;
  type_label: string | null;
  is_primary: boolean | null;
};

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
  disqualification_reason: string | null;
};

// JRIDE_EVENT_COMPANION_CONTEXT_V1
type GuestLinkRow = {
  primary_attendee_id: string;
  guest_attendee_id: string;
  relationship: string | null;
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

function isEligible(row: AttendeeRow) {
  return !isDisqualified(row);
}

function isAbsent(row: AttendeeRow) {
  return isEligible(row) && !isCheckedIn(row);
}

function humanizeTypeKey(value: string) {
  return String(value || "attendee")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function typeLabel(row: AttendeeTypeRow | undefined | null) {
  return (
    String(row?.type_label || "").trim() ||
    humanizeTypeKey(row?.type_key || "")
  );
}

function breakdown(rows: AttendeeRow[]) {
  const eligible = rows.filter(isEligible);
  const checkedIn = eligible.filter(isCheckedIn);
  const absent = eligible.filter((row) => !isCheckedIn(row));
  const disqualified = rows.filter(isDisqualified);

  return {
    records: rows.length,
    registered: eligible.length,
    checkedIn: checkedIn.length,
    absent: absent.length,
    disqualified: disqualified.length,
  };
}

function buildGroupSummary(rows: AttendeeRow[]) {
  const groupMap = new Map<
    string,
    {
      groupValue: string;
      rows: AttendeeRow[];
    }
  >();

  for (const attendee of rows) {
    const groupValue = String(attendee.group_value || "Unknown");

    const current = groupMap.get(groupValue) || {
      groupValue,
      rows: [],
    };

    current.rows.push(attendee);
    groupMap.set(groupValue, current);
  }

  return Array.from(groupMap.values())
    .map((entry) => ({
      groupValue: entry.groupValue,
      ...breakdown(entry.rows),
    }))
    .sort((left, right) =>
      left.groupValue.localeCompare(right.groupValue, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
}

export async function GET(
  _req: Request,
  { params }: { params: { eventSlug: string } }
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

    const { data: attendeeTypeData, error: typeError } = await supabase
      .from("event_attendee_types")
      .select("id,type_key,type_label,is_primary")
      .eq("event_id", event.id)
      .order("sort_order", { ascending: true });

    if (typeError) throw new Error(typeError.message);

    const attendeeTypes =
      (attendeeTypeData || []) as AttendeeTypeRow[];

    const primaryType =
      attendeeTypes.find((row) => row.is_primary === true) || null;

    const guestType =
      attendeeTypes.find((row) => row.type_key === "guest") || null;

    if (!primaryType?.id) {
      return NextResponse.json(
        {
          success: false,
          error: "Primary attendee type not found for this event.",
        },
        { status: 500 }
      );
    }

    const [attendeesResult, raffleResult, guestLinksResult] = await Promise.all([
      supabase
        .from("event_attendees")
        .select(
          "id,attendee_type_id,full_name,mobile_number,group_value,registration_number,registration_source,registration_status,attendance_status,registered_at,checked_in_at,is_disqualified,disqualification_reason"
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

      supabase
        .from("event_guest_links")
        .select(
          "primary_attendee_id,guest_attendee_id,relationship"
        )
        .eq("event_id", event.id)
        .order("created_at", { ascending: true }),
    ]);

    if (attendeesResult.error) {
      throw new Error(attendeesResult.error.message);
    }

    if (raffleResult.error) {
      throw new Error(raffleResult.error.message);
    }

    if (guestLinksResult.error) {
      throw new Error(guestLinksResult.error.message);
    }

    const attendees = (attendeesResult.data || []) as AttendeeRow[];

    const typeById = new Map(
      attendeeTypes.map((row) => [row.id, row])
    );

    const attendeeById = new Map(
      attendees.map((row) => [row.id, row])
    );

    const primaryLinkByGuestId = new Map<string, GuestLinkRow>();
    const companionLinksByPrimaryId = new Map<string, GuestLinkRow[]>();

    for (const link of (guestLinksResult.data || []) as GuestLinkRow[]) {
      primaryLinkByGuestId.set(link.guest_attendee_id, link);

      const current =
        companionLinksByPrimaryId.get(link.primary_attendee_id) || [];

      current.push(link);
      companionLinksByPrimaryId.set(link.primary_attendee_id, current);
    }

    function companionContext(attendeeId: string) {
      const primaryLink = primaryLinkByGuestId.get(attendeeId) || null;
      const primary = primaryLink
        ? attendeeById.get(primaryLink.primary_attendee_id) || null
        : null;

      const companionOf = primary
        ? {
            attendeeId: primary.id,
            fullName: primary.full_name,
            registrationNumber: primary.registration_number,
            groupValue: primary.group_value,
            relationship: primaryLink?.relationship || null,
          }
        : null;

      const companions = (
        companionLinksByPrimaryId.get(attendeeId) || []
      )
        .map((link) => {
          const guest = attendeeById.get(link.guest_attendee_id);

          if (!guest) return null;

          return {
            attendeeId: guest.id,
            fullName: guest.full_name,
            registrationNumber: guest.registration_number,
            groupValue: guest.group_value,
            relationship: link.relationship || null,
          };
        })
        .filter(
          (
            value
          ): value is {
            attendeeId: string;
            fullName: string;
            registrationNumber: string;
            groupValue: string | null;
            relationship: string | null;
          } => Boolean(value)
        );

      return {
        companionOf,
        companions,
      };
    }

    const primaryAttendees = attendees.filter(
      (row) => row.attendee_type_id === primaryType.id
    );

    const guestAttendees = guestType?.id
      ? attendees.filter((row) => row.attendee_type_id === guestType.id)
      : [];

    const otherAttendees = attendees.filter(
      (row) =>
        row.attendee_type_id !== primaryType.id &&
        (!guestType?.id || row.attendee_type_id !== guestType.id)
    );

    const eligibleAttendees = attendees.filter(isEligible);
    const eligibleCheckedIn = eligibleAttendees.filter(isCheckedIn);
    const eligibleAbsent = eligibleAttendees.filter(
      (row) => !isCheckedIn(row)
    );
    const allDisqualified = attendees.filter(isDisqualified);

    const primarySummary = breakdown(primaryAttendees);
    const guestSummary = breakdown(guestAttendees);
    const otherSummary = breakdown(otherAttendees);
    const totalSummary = breakdown(attendees);

    const attendanceRate =
      eligibleAttendees.length > 0
        ? Number(
            (
              (eligibleCheckedIn.length / eligibleAttendees.length) *
              100
            ).toFixed(2)
          )
        : 0;

    const attendeeTypeSummary = attendeeTypes.map((attendeeType) => {
      const rows = attendees.filter(
        (row) => row.attendee_type_id === attendeeType.id
      );

      return {
        attendeeTypeId: attendeeType.id,
        typeKey: attendeeType.type_key,
        typeLabel: typeLabel(attendeeType),
        isPrimary: attendeeType.is_primary === true,
        ...breakdown(rows),
      };
    });

    const batchSummary = buildGroupSummary(primaryAttendees);
    const groupSummary = buildGroupSummary(attendees);

    const registrants = attendees
      .slice()
      .sort((left, right) =>
        left.registration_number.localeCompare(
          right.registration_number,
          undefined,
          { numeric: true }
        )
      )
      .map((row) => {
        const attendeeType = typeById.get(row.attendee_type_id);

        return {
          attendeeId: row.id,
          attendeeType: attendeeType?.type_key || "attendee",
          attendeeTypeLabel: typeLabel(attendeeType),
          fullName: row.full_name,
          mobileNumber: row.mobile_number,
          groupValue: row.group_value,
          registrationNumber: row.registration_number,
          registrationSource: row.registration_source,
          registrationStatus: row.registration_status,
          attendanceStatus: row.attendance_status,
          checkedInAt: row.checked_in_at,
          isDisqualified: isDisqualified(row),
          disqualificationReason: row.disqualification_reason,
          ...companionContext(row.id),
        };
      });

    const absentees = eligibleAbsent
      .sort((a, b) => {
        const groupCompare = String(a.group_value || "").localeCompare(
          String(b.group_value || ""),
          undefined,
          { numeric: true, sensitivity: "base" }
        );

        if (groupCompare !== 0) return groupCompare;

        return a.full_name.localeCompare(b.full_name, undefined, {
          sensitivity: "base",
        });
      })
      .map((row) => {
        const attendeeType = typeById.get(row.attendee_type_id);

        return {
          attendeeId: row.id,
          attendeeType: attendeeType?.type_key || "attendee",
          attendeeTypeLabel: typeLabel(attendeeType),
          fullName: row.full_name,
          mobileNumber: row.mobile_number,
          groupValue: row.group_value,
          registrationNumber: row.registration_number,
          registrationSource: row.registration_source,
          registeredAt: row.registered_at,
          ...companionContext(row.id),
        };
      });

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
        groupLabel: event.group_label || "Group",
        status: event.status,
        primaryAttendeeTypeKey: primaryType.type_key,
        primaryAttendeeTypeLabel: typeLabel(primaryType),
        guestAttendeeTypeLabel: guestType
          ? typeLabel(guestType)
          : null,
      },
      summary: {
        primary: primarySummary,

        // Backward-compatible alias for the existing standalone Reports page.
        // "registered" now means eligible registered records.
        alumni: primarySummary,

        guests: guestSummary,
        other: otherSummary,
        total: {
          ...totalSummary,
          checkedIn: eligibleCheckedIn.length,
          absent: eligibleAbsent.length,
          disqualified: allDisqualified.length,
          attendanceRate,
        },
      },
      attendeeTypeSummary,
      batchSummary,
      groupSummary,
      registrants,
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
