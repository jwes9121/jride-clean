import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/auth/requireStaff";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type EligibleRow = {
  id: string;
  full_name: string;
  group_value: string | null;
  attendee_type:
    | {
        raffle_eligible: boolean | null;
      }
    | {
        raffle_eligible: boolean | null;
      }[]
    | null;
};

function isEligible(row: EligibleRow) {
  const attendeeType = Array.isArray(row.attendee_type)
    ? row.attendee_type[0]
    : row.attendee_type;

  return attendeeType?.raffle_eligible === true;
}

function shuffle<T>(items: T[]) {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [
      result[randomIndex],
      result[index],
    ];
  }

  return result;
}

export async function GET(
  _req: Request,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const authorization = await requireStaff(["admin","dispatcher"]);

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

    const { data: rows, error: rowsError } = await supabase
      .from("event_attendees")
      .select(
        "id,full_name,group_value,attendee_type:event_attendee_types!event_attendees_attendee_type_id_fkey(raffle_eligible)"
      )
      .eq("event_id", event.id)
      .eq("attendance_status", "checked_in")
      .eq("is_disqualified", false)
      .is("merged_into", null)
      .limit(5000);

    if (rowsError) throw new Error(rowsError.message);

    const eligible = ((rows || []) as EligibleRow[])
      .filter(isEligible)
      .map((row) => ({
        attendeeId: row.id,
        fullName: row.full_name,
        groupValue: row.group_value,
      }));

    return NextResponse.json({
      success: true,
      eventSlug: event.slug,
      groupLabel: event.group_label || "Batch",
      count: eligible.length,
      names: shuffle(eligible),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Raffle animation names failed to load.",
      },
      { status: 500 }
    );
  }
}
