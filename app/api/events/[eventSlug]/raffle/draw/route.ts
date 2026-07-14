import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/auth/requireStaff";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DrawType = "hourly" | "minor" | "major" | "grand";

type DrawRpcRow = {
  draw_id: string;
  winner_id: string;
  attendee_id: string;
  full_name: string;
  group_value: string | null;
  registration_number: string;
  reveal_at: string;
  claim_deadline_at: string;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function isDrawType(value: string): value is DrawType {
  return ["hourly", "minor", "major", "grand"].includes(value);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { eventSlug: string } }
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

    let body: Record<string, unknown> = {};

    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const drawName = cleanText(body.drawName) || "Raffle Draw";
    const requestedType = cleanText(body.drawType) || "minor";
    const rollSeconds = Number(body.rollSeconds ?? 60);
    const claimSeconds = Number(body.claimSeconds ?? 20);

    if (!isDrawType(requestedType)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid draw type.",
        },
        { status: 400 }
      );
    }

    if (
      !Number.isInteger(rollSeconds) ||
      rollSeconds < 10 ||
      rollSeconds > 180
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Roll duration must be between 10 and 180 seconds.",
        },
        { status: 400 }
      );
    }

    if (
      !Number.isInteger(claimSeconds) ||
      claimSeconds < 10 ||
      claimSeconds > 120
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Claim duration must be between 10 and 120 seconds.",
        },
        { status: 400 }
      );
    }

    const supabase = supabaseAdmin();

    const { data, error } = await supabase.rpc("event_start_raffle_draw", {
      p_event_slug: params.eventSlug,
      p_draw_name: drawName,
      p_draw_type: requestedType,
      p_roll_seconds: rollSeconds,
      p_claim_seconds: claimSeconds,
    });

    if (error) {
      const message = error.message || "Raffle draw failed.";

      if (
        message.includes("active raffle draw") ||
        message.includes("already exists")
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "An active raffle draw already exists.",
          },
          { status: 409 }
        );
      }

      if (message.includes("No eligible raffle attendees")) {
        return NextResponse.json(
          {
            success: false,
            error: "No eligible checked-in attendees are available.",
          },
          { status: 409 }
        );
      }

      if (message.includes("Event not found")) {
        return NextResponse.json(
          {
            success: false,
            error: "Event not found.",
          },
          { status: 404 }
        );
      }

      throw new Error(message);
    }

    const row = (Array.isArray(data) ? data[0] : data) as DrawRpcRow | null;

    if (
      !row?.draw_id ||
      !row.winner_id ||
      !row.attendee_id ||
      !row.full_name ||
      !row.registration_number ||
      !row.reveal_at ||
      !row.claim_deadline_at
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Raffle draw returned incomplete winner data.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      draw: {
        drawId: row.draw_id,
        drawName,
        drawType: requestedType,
        rollSeconds,
        revealAt: row.reveal_at,
        claimDeadlineAt: row.claim_deadline_at,
      },
      winner: {
        winnerId: row.winner_id,
        attendeeId: row.attendee_id,
        fullName: row.full_name,
        groupValue: row.group_value,
        registrationNumber: row.registration_number,
        status: "selected",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Raffle draw failed.",
      },
      { status: 500 }
    );
  }
}
