import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/auth/requireStaff";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type EligibleRow = {
  attendee_id: string;
  full_name: string;
  group_value: string | null;
  registration_number: string;
  registration_source: string | null;
  attendance_status: string;
};
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

    const { data: rows, error: rowsError } =
      await supabase.rpc(
        "event_raffle_eligible_attendees_v2",
        {
          p_event_slug: params.eventSlug,
        }
      );

    if (rowsError) throw new Error(rowsError.message);

    const eligible = ((rows || []) as EligibleRow[]).map(
      (row) => ({
        attendeeId: row.attendee_id,
        fullName: row.full_name,
        groupValue: row.group_value,
      })
    );
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
