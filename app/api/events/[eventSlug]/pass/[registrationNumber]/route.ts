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

type ParticipationRow = {
  attendee_id: string;
  fun_walk: boolean;
  assist: boolean;
  lunch_meet_greet: boolean;
};

type GroupValueRow = {
  value: string;
  label: string;
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
        .in("status", [
          "published",
          "registration_open",
          "registration_closed",
          "live",
          "completed",
        ])
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
      groupValuesResult,
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

      // No is_active filter, deliberately: is_active gates whether a
      // value is currently selectable at registration time, not whether
      // an already-registered attendee's category should still resolve
      // to a friendly label on their pass. Confirmed live: both
      // batch_2001_member and golden_jubilarian are currently
      // is_active = false but still need to display correctly here.
      supabase
        .from("event_group_values")
        .select("value,label")
        .eq("event_id", event.id),
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

    if (groupValuesResult.error) {
      throw new Error(groupValuesResult.error.message);
    }

    // event_guest_links' embedded guest relation can come back as either
    // a single object or a one-element array depending on Supabase's
    // relationship inference - same ambiguity the page already defends
    // against in normalizeGuests. Handled the same way here so the
    // participation query gets a clean, deduplicated id list either way.
    const rawGuestLinks = (guestLinksResult.data ||
      []) as {
      relationship: string;
      guest:
        | { id: string }
        | { id: string }[]
        | null;
    }[];

    const guestIds = rawGuestLinks
      .map((row) =>
        Array.isArray(row.guest)
          ? row.guest[0]?.id
          : row.guest?.id
      )
      .filter((id): id is string => Boolean(id));

    const participationAttendeeIds = [
      attendee.id,
      ...guestIds,
    ];

    const participationResult = await supabase
      .from("event_attendee_participation")
      .select("attendee_id,fun_walk,assist,lunch_meet_greet")
      .in("attendee_id", participationAttendeeIds);

    if (participationResult.error) {
      throw new Error(participationResult.error.message);
    }

    const participationByAttendeeId = new Map<
      string,
      ParticipationRow
    >();

    for (const row of (participationResult.data ||
      []) as ParticipationRow[]) {
      participationByAttendeeId.set(
        row.attendee_id,
        row
      );
    }

    function participationFor(attendeeId: string) {
      const row =
        participationByAttendeeId.get(attendeeId);

      if (!row) return null;

      return {
        funWalk: row.fun_walk,
        assist: row.assist,
        lunchMeetGreet: row.lunch_meet_greet,
      };
    }

    const groupValueLabels = new Map<
      string,
      string
    >();

    for (const row of (groupValuesResult.data ||
      []) as GroupValueRow[]) {
      groupValueLabels.set(row.value, row.label);
    }

    function labelFor(value: string) {
      return groupValueLabels.get(value) || value;
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
      attendee: {
        ...attendee,
        group_value_label: labelFor(
          attendee.group_value
        ),
        participation: participationFor(
          attendee.id
        ),
      },
      guests: guestLinksResult.data || [],
      // Keyed lookup rather than embedding participation inside the raw
      // guest-link rows, since that embed's shape (object vs. one-element
      // array) is already ambiguous - the page can look this up by id
      // once it has flattened the guest list itself.
      guestParticipation: Object.fromEntries(
        guestIds.map((id) => [id, participationFor(id)])
      ),
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
