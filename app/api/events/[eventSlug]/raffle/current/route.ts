import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type WinnerRow = {
  id: string;
  draw_id: string;
  status: string;
  claim_deadline_at: string | null;
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
};

function normalizeAttendee(row: WinnerRow) {
  const attendee = Array.isArray(row.attendee) ? row.attendee[0] : row.attendee;

  if (!attendee) return null;

  return {
    attendeeId: attendee.id,
    fullName: attendee.full_name,
    groupValue: attendee.group_value,
    registrationNumber: attendee.registration_number,
  };
}

export async function GET(
  _req: Request,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const supabase = supabaseAdmin();

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id,name,slug,group_label")
      .eq("slug", params.eventSlug)
      .maybeSingle();

    if (eventError) throw new Error(eventError.message);

    if (!event?.id) {
      return NextResponse.json(
        { success: false, error: "Event not found." },
        { status: 404 }
      );
    }

    const { data: eligibleRows, error: eligibleError } = await supabase
      .from("event_attendees")
      .select("id,attendee_type:event_attendee_types!event_attendees_attendee_type_id_fkey(raffle_eligible)")
      .eq("event_id", event.id)
      .eq("attendance_status", "checked_in")
      .eq("is_disqualified", false)
      .is("merged_into", null);

    if (eligibleError) throw new Error(eligibleError.message);

    const { data: existingWinnerRows, error: existingWinnerError } = await supabase
      .from("event_raffle_winners")
      .select("attendee_id")
      .eq("event_id", event.id)
      .in("status", ["selected", "claimed"]);

    if (existingWinnerError) throw new Error(existingWinnerError.message);

    const blockedIds = new Set((existingWinnerRows || []).map((row) => row.attendee_id));

    const eligibleCount = (eligibleRows || []).filter((row: any) => {
      const attendeeType = Array.isArray(row.attendee_type)
        ? row.attendee_type[0]
        : row.attendee_type;

      return attendeeType?.raffle_eligible === true && !blockedIds.has(row.id);
    }).length;

    const { data: activeDraw, error: activeDrawError } = await supabase
      .from("event_raffle_draws")
      .select("id,draw_name,draw_type,status,started_at,winner_selected_at,completed_at,created_at,updated_at")
      .eq("event_id", event.id)
      .in("status", ["rolling", "winner_selected"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeDrawError) throw new Error(activeDrawError.message);

    let activeWinner: WinnerRow | null = null;

    if (activeDraw?.id) {
      const { data: winner, error: winnerError } = await supabase
        .from("event_raffle_winners")
        .select(
          "id,draw_id,status,claim_deadline_at,claimed_at,attendee:event_attendees!event_raffle_winners_attendee_id_fkey(id,full_name,group_value,registration_number)"
        )
        .eq("draw_id", activeDraw.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (winnerError) throw new Error(winnerError.message);

      activeWinner = winner as WinnerRow | null;
    }

    const { data: historyRows, error: historyError } = await supabase
      .from("event_raffle_winners")
      .select(
        "id,draw_id,status,claim_deadline_at,claimed_at,attendee:event_attendees!event_raffle_winners_attendee_id_fkey(id,full_name,group_value,registration_number)"
      )
      .eq("event_id", event.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (historyError) throw new Error(historyError.message);

    const serverNow = new Date();
    const revealAt = activeDraw?.winner_selected_at
      ? new Date(activeDraw.winner_selected_at)
      : null;
    const claimDeadlineAt = activeWinner?.claim_deadline_at
      ? new Date(activeWinner.claim_deadline_at)
      : null;

    const phase =
      !activeDraw
        ? "idle"
        : revealAt && serverNow < revealAt
        ? "rolling"
        : claimDeadlineAt && serverNow < claimDeadlineAt
        ? "claim"
        : "expired";

    const secondsUntilReveal =
      revealAt === null
        ? null
        : Math.max(
            0,
            Math.ceil((revealAt.getTime() - serverNow.getTime()) / 1000)
          );

    const secondsUntilClaimDeadline =
      claimDeadlineAt === null
        ? null
        : Math.max(
            0,
            Math.ceil(
              (claimDeadlineAt.getTime() - serverNow.getTime()) / 1000
            )
          );

    return NextResponse.json({
      success: true,
      generatedAt: serverNow.toISOString(),
      phase,
      secondsUntilReveal,
      secondsUntilClaimDeadline,
      event: {
        title: event.name,
        slug: event.slug,
        groupLabel: event.group_label || "Batch",
      },
      eligibleCount,
      activeDraw: activeDraw
        ? {
            drawId: activeDraw.id,
            drawName: activeDraw.draw_name,
            drawType: activeDraw.draw_type,
            status: activeDraw.status,
            startedAt: activeDraw.started_at,
            revealAt: activeDraw.winner_selected_at,
            completedAt: activeDraw.completed_at,
            phase,
            secondsUntilReveal,
            secondsUntilClaimDeadline,
            winner: activeWinner
              ? {
                  winnerId: activeWinner.id,
                  status: activeWinner.status,
                  claimDeadlineAt: activeWinner.claim_deadline_at,
                  claimedAt: activeWinner.claimed_at,
                  attendee: normalizeAttendee(activeWinner),
                }
              : null,
          }
        : null,
      history: ((historyRows || []) as WinnerRow[]).map((row) => ({
        winnerId: row.id,
        drawId: row.draw_id,
        status: row.status,
        claimDeadlineAt: row.claim_deadline_at,
        claimedAt: row.claimed_at,
        attendee: normalizeAttendee(row),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Raffle state failed to load.",
      },
      { status: 500 }
    );
  }
}
