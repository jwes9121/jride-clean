import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/auth/requireStaff";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_MAP = {
  claim: {
    winner: "claimed",
    draw: "claimed",
  },
  unclaimed: {
    winner: "unclaimed",
    draw: "unclaimed",
  },
} as const;

export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: { eventSlug: string; winnerId: string };
  }
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

    const body = await req.json();
    type RaffleAction = keyof typeof STATUS_MAP;

    const requestedAction = String(body.action || "");
    const action: RaffleAction | null =
      requestedAction === "claim" || requestedAction === "unclaimed"
        ? requestedAction
        : null;

    if (!action) {
      return NextResponse.json(
        {
          success: false,
          error: "Action must be 'claim' or 'unclaimed'.",
        },
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

    const { data: winner, error: winnerError } = await supabase
      .from("event_raffle_winners")
      .select("id,draw_id,status")
      .eq("id", params.winnerId)
      .eq("event_id", event.id)
      .maybeSingle();

    if (winnerError) throw new Error(winnerError.message);

    if (!winner?.id) {
      return NextResponse.json(
        { success: false, error: "Winner not found." },
        { status: 404 }
      );
    }

    const targetStatus = STATUS_MAP[action].winner;

    if (winner.status === targetStatus) {
      return NextResponse.json({
        success: true,
        noChange: true,
        winnerId: winner.id,
        status: winner.status,
      });
    }

    const now = new Date().toISOString();

    const { error: updateWinnerError } = await supabase
      .from("event_raffle_winners")
      .update({
        status: targetStatus,
        claimed_at: action === "claim" ? now : null,
      })
      .eq("id", winner.id);

    if (updateWinnerError) throw new Error(updateWinnerError.message);

    const { error: updateDrawError } = await supabase
      .from("event_raffle_draws")
      .update({
        status: STATUS_MAP[action].draw,
        completed_at: now,
        updated_at: now,
      })
      .eq("id", winner.draw_id);

    if (updateDrawError) throw new Error(updateDrawError.message);

    return NextResponse.json({
      success: true,
      winnerId: winner.id,
      status: targetStatus,
      completedAt: now,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Raffle winner update failed.",
      },
      { status: 500 }
    );
  }
}
