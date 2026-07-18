import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CheckpointRow = {
  id: string;
  checkpoint_no: number;
  checkpoint_name: string;
  sort_order: number;
};

type PassageRow = {
  id: string;
  checkpoint_id: string;
  passed_at: string;
};

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  req: NextRequest,
  {
    params,
  }: {
    params: {
      eventSlug: string;
      registrationNumber: string;
    };
  }
) {
  try {
    const token = String(
      req.nextUrl.searchParams.get("token") || ""
    ).trim();

    if (!token) {
      return noStore(
        {
          success: false,
          error: "Pass token is required.",
        },
        401
      );
    }

    const supabase = supabaseAdmin();

    const { data: event, error: eventError } =
      await supabase
        .from("events")
        .select(
          "id,slug,name,short_name,event_date,venue,group_label"
        )
        .eq("slug", params.eventSlug)
        .eq("status", "published")
        .maybeSingle();

    if (eventError) {
      throw new Error(eventError.message);
    }

    if (!event?.id) {
      return noStore(
        {
          success: false,
          error: "Event not found.",
        },
        404
      );
    }

    const registrationNumber = decodeURIComponent(
      params.registrationNumber
    );

    const { data: attendee, error: attendeeError } =
      await supabase
        .from("event_attendees")
        .select(
          "id,full_name,nickname,group_value,registration_number,qr_token,attendance_status,checked_in_at,is_disqualified,disqualification_reason"
        )
        .eq("event_id", event.id)
        .eq("registration_number", registrationNumber)
        .eq("qr_token", token)
        .is("merged_into", null)
        .maybeSingle();

    if (attendeeError) {
      throw new Error(attendeeError.message);
    }

    if (!attendee?.id) {
      return noStore(
        {
          success: false,
          error:
            "Event pass not found or token is invalid.",
        },
        404
      );
    }

    const [
      guestLinksResult,
      checkpointsResult,
      passagesResult,
    ] = await Promise.all([
      supabase
        .from("event_guest_links")
        .select(
          "relationship,guest:event_attendees!event_guest_links_guest_attendee_id_fkey(id,full_name,registration_number,attendance_status)"
        )
        .eq("event_id", event.id)
        .eq("primary_attendee_id", attendee.id)
        .order("created_at", { ascending: true }),

      supabase
        .from("event_checkpoints")
        .select(
          "id,checkpoint_no,checkpoint_name,sort_order"
        )
        .eq("event_id", event.id)
        .order("sort_order", { ascending: true }),

      supabase
        .from("event_checkpoint_passages")
        .select("id,checkpoint_id,passed_at")
        .eq("event_id", event.id)
        .eq("attendee_id", attendee.id)
        .order("passed_at", { ascending: true }),
    ]);

    if (guestLinksResult.error) {
      throw new Error(guestLinksResult.error.message);
    }

    if (checkpointsResult.error) {
      throw new Error(checkpointsResult.error.message);
    }

    if (passagesResult.error) {
      throw new Error(passagesResult.error.message);
    }

    const checkpoints =
      (checkpointsResult.data || []) as CheckpointRow[];

    const passages =
      (passagesResult.data || []) as PassageRow[];

    const passageByCheckpointId = new Map<
      string,
      PassageRow
    >();

    for (const passage of passages) {
      if (
        !passageByCheckpointId.has(
          passage.checkpoint_id
        )
      ) {
        passageByCheckpointId.set(
          passage.checkpoint_id,
          passage
        );
      }
    }

    const timeline = checkpoints.map(
      (checkpoint, index) => {
        const passage = passageByCheckpointId.get(
          checkpoint.id
        );

        return {
          checkpointId: checkpoint.id,
          checkpointNo: checkpoint.checkpoint_no,
          checkpointName:
            checkpoint.checkpoint_name,
          sortOrder: checkpoint.sort_order,
          sequence: index + 1,
          status: passage ? "passed" : "pending",
          passageId: passage?.id || null,
          passedAt: passage?.passed_at || null,
        };
      }
    );

    const passedCheckpoints = timeline.filter(
      (item) => item.status === "passed"
    );

    const latestPassedCheckpoint =
      passedCheckpoints.length > 0
        ? passedCheckpoints[
            passedCheckpoints.length - 1
          ]
        : null;

    const nextCheckpoint =
      timeline.find(
        (item) => item.status === "pending"
      ) || null;

    const progressPercent =
      checkpoints.length > 0
        ? Math.round(
            (passedCheckpoints.length /
              checkpoints.length) *
              100
          )
        : 0;

    return noStore({
      success: true,
      event,
      attendee,
      guests: guestLinksResult.data || [],
      runnerProgress: {
        totalCheckpoints: checkpoints.length,
        passedCheckpoints:
          passedCheckpoints.length,
        remainingCheckpoints:
          Math.max(
            0,
            checkpoints.length -
              passedCheckpoints.length
          ),
        progressPercent,
        isComplete:
          checkpoints.length > 0 &&
          passedCheckpoints.length ===
            checkpoints.length,
        latestCheckpoint:
          latestPassedCheckpoint,
        nextCheckpoint,
        timeline,
      },
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load event pass.",
      },
      500
    );
  }
}
