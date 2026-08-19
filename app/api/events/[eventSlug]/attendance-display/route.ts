import { NextRequest, NextResponse } from "next/server";
import { requireEventStation } from "@/lib/events/requireEventStation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

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
    };
  }
) {
  try {
    const eventSlug = cleanText(params.eventSlug);
    const stationToken = cleanText(
      req.headers.get("x-event-station-token")
    );
    const supabase = supabaseAdmin();

    const { data: event, error: eventError } =
      await supabase
        .from("events")
        .select(
          "id,slug,name,short_name,event_date,venue,status"
        )
        .eq("slug", eventSlug)
        .maybeSingle();

    if (eventError) {
      throw new Error(eventError.message);
    }

    if (!event?.id) {
      return noStore(
        {
          success: false,
          reason: "event_not_found",
          message: "Event was not found.",
        },
        404
      );
    }

    const authorization =
      await requireEventStation(
        supabase,
        event.id,
        stationToken,
        "projector"
      );

    if (!authorization.ok) {
      return noStore(
        {
          success: false,
          reason: "station_auth_required",
          message:
            authorization.error ===
            "STATION_TOKEN_REQUIRED"
              ? "Attendance display authorization is required."
              : "Attendance display token is invalid, expired, or revoked.",
        },
        authorization.status
      );
    }

    const { data: primaryType, error: typeError } =
      await supabase
        .from("event_attendee_types")
        .select("id,type_label")
        .eq("event_id", event.id)
        .eq("is_primary", true)
        .maybeSingle();

    if (typeError) {
      throw new Error(typeError.message);
    }

    const eligibleBase = () =>
      supabase
        .from("event_attendees")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("event_id", event.id)
        .eq("registration_status", "registered")
        .eq("is_disqualified", false)
        .is("merged_into", null);

    const [
      registeredPeopleResult,
      presentPeopleResult,
      registeredParticipantsResult,
      presentParticipantsResult,
      checkpointsResult,
      latestCheckinResult,
    ] = await Promise.all([
      eligibleBase(),
      eligibleBase().eq(
        "attendance_status",
        "checked_in"
      ),
      primaryType?.id
        ? eligibleBase().eq(
            "attendee_type_id",
            primaryType.id
          )
        : Promise.resolve({
            count: 0,
            error: null,
          }),
      primaryType?.id
        ? eligibleBase()
            .eq(
              "attendee_type_id",
              primaryType.id
            )
            .eq(
              "attendance_status",
              "checked_in"
            )
        : Promise.resolve({
            count: 0,
            error: null,
          }),
      supabase
        .from("event_checkpoints")
        .select(
          "id,checkpoint_no,checkpoint_name,sort_order"
        )
        .eq("event_id", event.id)
        .order("sort_order", {
          ascending: true,
        }),
      supabase
        .from("event_attendees")
        .select("checked_in_at")
        .eq("event_id", event.id)
        .eq("attendance_status", "checked_in")
        .eq("is_disqualified", false)
        .is("merged_into", null)
        .order("checked_in_at", {
          ascending: false,
        })
        .limit(1),
    ]);

    for (const result of [
      registeredPeopleResult,
      presentPeopleResult,
      registeredParticipantsResult,
      presentParticipantsResult,
      checkpointsResult,
      latestCheckinResult,
    ]) {
      if (result.error) {
        throw new Error(result.error.message);
      }
    }

    const checkpoints =
      checkpointsResult.data || [];
    const startCheckpoint =
      checkpoints.length > 0
        ? checkpoints[0]
        : null;
    const finishCheckpoint =
      checkpoints.length > 0
        ? checkpoints[checkpoints.length - 1]
        : null;
    const checkpointIds = Array.from(
      new Set(
        [
          startCheckpoint?.id,
          finishCheckpoint?.id,
        ].filter(Boolean)
      )
    );

    let passageRows: {
      attendee_id: string;
      checkpoint_id: string;
      passed_at: string;
    }[] = [];

    if (checkpointIds.length > 0) {
      const passageResult = await supabase
        .from("event_checkpoint_passages")
        .select(
          "attendee_id,checkpoint_id,passed_at"
        )
        .eq("event_id", event.id)
        .in("checkpoint_id", checkpointIds)
        .order("passed_at", {
          ascending: false,
        })
        .limit(10000);

      if (passageResult.error) {
        throw new Error(passageResult.error.message);
      }

      passageRows = passageResult.data || [];
    }

    const startIds = new Set<string>();
    const finishIds = new Set<string>();
    let latestFinishAt: string | null = null;

    for (const row of passageRows) {
      if (
        startCheckpoint &&
        row.checkpoint_id === startCheckpoint.id
      ) {
        startIds.add(row.attendee_id);
      }

      if (
        finishCheckpoint &&
        row.checkpoint_id === finishCheckpoint.id
      ) {
        finishIds.add(row.attendee_id);

        if (!latestFinishAt) {
          latestFinishAt = row.passed_at;
        }
      }
    }

    const onCourse = Array.from(startIds).filter(
      (attendeeId) => !finishIds.has(attendeeId)
    ).length;
    const registeredPeople =
      registeredPeopleResult.count || 0;
    const presentPeople =
      presentPeopleResult.count || 0;
    const started = startIds.size;
    const finished = finishIds.size;

    return noStore({
      success: true,
      generatedAt: new Date().toISOString(),
      event: {
        id: event.id,
        slug: event.slug,
        name: event.name,
        shortName: event.short_name,
        eventDate: event.event_date,
        venue: event.venue,
        status: event.status,
      },
      station: {
        id: authorization.station.id,
        name: authorization.station.stationName,
      },
      labels: {
        primary:
          primaryType?.type_label ||
          "Participants",
        start:
          startCheckpoint?.checkpoint_name ||
          "Start",
        finish:
          finishCheckpoint?.checkpoint_name ||
          "Finish",
      },
      counts: {
        registeredPeople,
        presentPeople,
        awaitingArrival: Math.max(
          0,
          registeredPeople - presentPeople
        ),
        registeredParticipants:
          registeredParticipantsResult.count || 0,
        presentParticipants:
          presentParticipantsResult.count || 0,
        started,
        onCourse,
        finished,
        notStarted: Math.max(
          0,
          presentPeople - started
        ),
      },
      rates: {
        attendancePercent:
          registeredPeople > 0
            ? Math.round(
                (presentPeople /
                  registeredPeople) *
                  100
              )
            : 0,
        finishPercent:
          started > 0
            ? Math.round(
                (finished / started) * 100
              )
            : 0,
      },
      latest: {
        checkinAt:
          latestCheckinResult.data?.[0]
            ?.checked_in_at || null,
        finishAt: latestFinishAt,
      },
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        reason: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Attendance display failed.",
      },
      500
    );
  }
}