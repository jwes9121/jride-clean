import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/auth/requireStaff";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CheckpointRow = {
  id: string;
  checkpoint_no: number;
  checkpoint_name: string;
  sort_order: number;
};

type CheckpointStationRow = {
  id: string;
  checkpoint_id: string | null;
  station_name: string;
  status: string;
  expires_at: string;
  last_used_at: string | null;
};

type RecentPassageRow = {
  id: string;
  attendee_id: string;
  checkpoint_id: string;
  station_token_id: string;
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

function throwIfError(
  result: {
    error?: {
      message?: string;
    } | null;
  },
  fallback: string
) {
  if (result.error) {
    throw new Error(result.error.message || fallback);
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const authorization = await requireStaff(["admin", "dispatcher"]);

    if (!authorization.ok) {
      return noStore(
        {
          success: false,
          error: authorization.error,
        },
        authorization.status
      );
    }

    const supabase = supabaseAdmin();

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id,name,short_name,slug,event_date,group_label")
      .eq("slug", params.eventSlug)
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

    const { data: alumniType, error: alumniTypeError } = await supabase
      .from("event_attendee_types")
      .select("id")
      .eq("event_id", event.id)
      .eq("type_key", "alumni")
      .maybeSingle();

    if (alumniTypeError) {
      throw new Error(alumniTypeError.message);
    }

    if (!alumniType?.id) {
      return noStore(
        {
          success: false,
          error: "Alumni attendee type not found.",
        },
        500
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();

    const [
      registeredAlumniResult,
      checkedInResult,
      pendingReviewResult,
      guestsResult,
      velocity1Result,
      velocity5Result,
      velocity15Result,
      topBatchesResult,
      recentActivityResult,
      lastCheckinResult,
      checkpointsResult,
      totalCheckpointPassagesResult,
      checkpointStationsResult,
      recentCheckpointPassagesResult,
      allCheckpointPassagesResult,
    ] = await Promise.all([
      supabase
        .from("event_attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("attendee_type_id", alumniType.id)
        .is("merged_into", null),

      supabase
        .from("event_attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("attendance_status", "checked_in")
        .is("merged_into", null),

      supabase
        .from("event_attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("is_disqualified", true)
        .is("merged_into", null),

      supabase
        .from("event_guest_links")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id),

      supabase
        .from("event_attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("attendance_status", "checked_in")
        .is("merged_into", null)
        .gte(
          "checked_in_at",
          new Date(now.getTime() - 60_000).toISOString()
        ),

      supabase
        .from("event_attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("attendance_status", "checked_in")
        .is("merged_into", null)
        .gte(
          "checked_in_at",
          new Date(now.getTime() - 300_000).toISOString()
        ),

      supabase
        .from("event_attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("attendance_status", "checked_in")
        .is("merged_into", null)
        .gte(
          "checked_in_at",
          new Date(now.getTime() - 900_000).toISOString()
        ),

      supabase
        .from("event_attendees")
        .select("group_value")
        .eq("event_id", event.id)
        .eq("attendee_type_id", alumniType.id)
        .eq("attendance_status", "checked_in")
        .is("merged_into", null),

      supabase
        .from("event_attendees")
        .select(
          "id,full_name,group_value,attendance_status,checked_in_at,is_disqualified,attendee_type_id"
        )
        .eq("event_id", event.id)
        .eq("attendance_status", "checked_in")
        .is("merged_into", null)
        .order("checked_in_at", { ascending: false })
        .limit(20),

      supabase
        .from("event_attendees")
        .select("checked_in_at")
        .eq("event_id", event.id)
        .eq("attendance_status", "checked_in")
        .is("merged_into", null)
        .order("checked_in_at", { ascending: false })
        .limit(1),

      supabase
        .from("event_checkpoints")
        .select("id,checkpoint_no,checkpoint_name,sort_order")
        .eq("event_id", event.id)
        .order("sort_order", { ascending: true }),

      supabase
        .from("event_checkpoint_passages")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id),

      supabase
        .from("event_station_tokens")
        .select(
          "id,checkpoint_id,station_name,status,expires_at,last_used_at"
        )
        .eq("event_id", event.id)
        .eq("station_type", "checkpoint"),

      supabase
        .from("event_checkpoint_passages")
        .select(
          "id,attendee_id,checkpoint_id,station_token_id,passed_at"
        )
        .eq("event_id", event.id)
        .order("passed_at", { ascending: false })
        .limit(20),

      supabase
        .from("event_checkpoint_passages")
        .select(
          "id,attendee_id,checkpoint_id,station_token_id,passed_at"
        )
        .eq("event_id", event.id)
        .order("passed_at", { ascending: true }),
    ]);

    throwIfError(
      registeredAlumniResult,
      "Registered alumni count failed."
    );
    throwIfError(checkedInResult, "Checked-in count failed.");
    throwIfError(pendingReviewResult, "Pending-review count failed.");
    throwIfError(guestsResult, "Guest count failed.");
    throwIfError(velocity1Result, "One-minute velocity failed.");
    throwIfError(velocity5Result, "Five-minute velocity failed.");
    throwIfError(velocity15Result, "Fifteen-minute velocity failed.");
    throwIfError(topBatchesResult, "Top batches query failed.");
    throwIfError(recentActivityResult, "Recent activity query failed.");
    throwIfError(lastCheckinResult, "Latest check-in query failed.");
    throwIfError(checkpointsResult, "Checkpoint query failed.");
    throwIfError(
      totalCheckpointPassagesResult,
      "Checkpoint passage count failed."
    );
    throwIfError(
      checkpointStationsResult,
      "Checkpoint station query failed."
    );
    throwIfError(
      recentCheckpointPassagesResult,
      "Recent checkpoint activity query failed."
    );
    throwIfError(
      allCheckpointPassagesResult,
      "Runner tracking passage query failed."
    );

    const checkpoints =
      (checkpointsResult.data || []) as CheckpointRow[];

    const checkpointStations =
      (checkpointStationsResult.data || []) as CheckpointStationRow[];

    const recentCheckpointPassages =
      (recentCheckpointPassagesResult.data || []) as RecentPassageRow[];

    const allCheckpointPassages =
      (allCheckpointPassagesResult.data || []) as RecentPassageRow[];

    const checkpointMetrics = await Promise.all(
      checkpoints.map(async (checkpoint) => {
        const [countResult, lastPassageResult] = await Promise.all([
          supabase
            .from("event_checkpoint_passages")
            .select("id", { count: "exact", head: true })
            .eq("event_id", event.id)
            .eq("checkpoint_id", checkpoint.id),

          supabase
            .from("event_checkpoint_passages")
            .select("passed_at")
            .eq("event_id", event.id)
            .eq("checkpoint_id", checkpoint.id)
            .order("passed_at", { ascending: false })
            .limit(1),
        ]);

        throwIfError(
          countResult,
          `Passage count failed for ${checkpoint.checkpoint_name}.`
        );
        throwIfError(
          lastPassageResult,
          `Latest passage failed for ${checkpoint.checkpoint_name}.`
        );

        return {
          checkpointId: checkpoint.id,
          checkpointName: checkpoint.checkpoint_name,
          checkpointNo: checkpoint.checkpoint_no,
          sortOrder: checkpoint.sort_order,
          passages: countResult.count || 0,
          lastPassageAt:
            lastPassageResult.data?.[0]?.passed_at || null,
        };
      })
    );

    const attendeeIds = Array.from(
      new Set(
        recentCheckpointPassages
          .map((row) => row.attendee_id)
          .filter(Boolean)
      )
    );

    const stationTokenIds = Array.from(
      new Set(
        recentCheckpointPassages
          .map((row) => row.station_token_id)
          .filter(Boolean)
      )
    );

    const [passageAttendeesResult, passageStationsResult] =
      await Promise.all([
        attendeeIds.length > 0
          ? supabase
              .from("event_attendees")
              .select("id,full_name,registration_number")
              .eq("event_id", event.id)
              .in("id", attendeeIds)
          : Promise.resolve({
              data: [],
              error: null,
            }),

        stationTokenIds.length > 0
          ? supabase
              .from("event_station_tokens")
              .select("id,station_name")
              .eq("event_id", event.id)
              .in("id", stationTokenIds)
          : Promise.resolve({
              data: [],
              error: null,
            }),
      ]);

    throwIfError(
      passageAttendeesResult,
      "Checkpoint attendee lookup failed."
    );
    throwIfError(
      passageStationsResult,
      "Checkpoint station lookup failed."
    );

    const checkpointById = new Map(
      checkpoints.map((checkpoint) => [
        checkpoint.id,
        checkpoint,
      ])
    );

    const attendeeById = new Map(
      (passageAttendeesResult.data || []).map((attendee) => [
        attendee.id,
        attendee,
      ])
    );

    const stationById = new Map(
      (passageStationsResult.data || []).map((station) => [
        station.id,
        station,
      ])
    );

    const activeCheckpointStations = checkpointStations.filter(
      (station) =>
        station.status === "active" &&
        new Date(station.expires_at).getTime() > now.getTime()
    );

    const activeStationIds = new Set(
      activeCheckpointStations.map((station) => station.id)
    );

    const offlineCheckpointStations = checkpointStations.filter(
      (station) => !activeStationIds.has(station.id)
    );

    const batchCounts: Record<string, number> = {};

    for (const row of topBatchesResult.data || []) {
      const key = String(row.group_value || "Unknown");
      batchCounts[key] = (batchCounts[key] || 0) + 1;
    }

    const topBatches = Object.entries(batchCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([value, count]) => ({
        value,
        count,
      }));

    const lastCheckinAt =
      lastCheckinResult.data?.[0]?.checked_in_at || null;

    const secondsSinceLastScan = lastCheckinAt
      ? Math.floor(
          (now.getTime() -
            new Date(lastCheckinAt).getTime()) /
            1000
        )
      : null;

    const scannerStatus =
      secondsSinceLastScan === null
        ? "unknown"
        : secondsSinceLastScan < 600
        ? "online"
        : "idle";

    const trackingAttendeeIds = Array.from(
      new Set(
        allCheckpointPassages
          .map((passage) => passage.attendee_id)
          .filter(Boolean)
      )
    );

    const trackingAttendeesResult =
      trackingAttendeeIds.length > 0
        ? await supabase
            .from("event_attendees")
            .select(
              "id,full_name,registration_number,group_value,is_disqualified"
            )
            .eq("event_id", event.id)
            .is("merged_into", null)
            .in("id", trackingAttendeeIds)
        : {
            data: [],
            error: null,
          };

    throwIfError(
      trackingAttendeesResult,
      "Runner tracking attendee query failed."
    );

    const trackingAttendeeById = new Map(
      (trackingAttendeesResult.data || []).map(
        (attendee) => [attendee.id, attendee]
      )
    );

    const passagesByAttendee = new Map<
      string,
      RecentPassageRow[]
    >();

    for (const passage of allCheckpointPassages) {
      const current =
        passagesByAttendee.get(passage.attendee_id) || [];

      current.push(passage);

      passagesByAttendee.set(
        passage.attendee_id,
        current
      );
    }

    const stallThresholdRaw = String(
      process.env.EVENT_STALLED_RUNNER_MINUTES || ""
    ).trim();

    const stallThresholdMinutes =
      stallThresholdRaw &&
      Number.isFinite(Number(stallThresholdRaw)) &&
      Number(stallThresholdRaw) > 0
        ? Math.floor(Number(stallThresholdRaw))
        : null;

    const runnerTracking = Array.from(
      passagesByAttendee.entries()
    )
      .map(([attendeeId, passages]) => {
        const attendee =
          trackingAttendeeById.get(attendeeId);

        if (!attendee) {
          return null;
        }

        const uniquePassageByCheckpoint =
          new Map<string, RecentPassageRow>();

        for (const passage of passages) {
          if (
            !uniquePassageByCheckpoint.has(
              passage.checkpoint_id
            )
          ) {
            uniquePassageByCheckpoint.set(
              passage.checkpoint_id,
              passage
            );
          }
        }

        const timeline = checkpoints.map(
          (checkpoint, index) => {
            const passage =
              uniquePassageByCheckpoint.get(
                checkpoint.id
              );

            return {
              checkpointId: checkpoint.id,
              checkpointNo:
                checkpoint.checkpoint_no,
              checkpointName:
                checkpoint.checkpoint_name,
              sortOrder:
                checkpoint.sort_order,
              sequence: index + 1,
              status: passage
                ? "passed"
                : "pending",
              passedAt:
                passage?.passed_at || null,
            };
          }
        );

        const passedTimeline = timeline.filter(
          (item) => item.status === "passed"
        );

        const latestCheckpoint =
          passedTimeline.length > 0
            ? passedTimeline[
                passedTimeline.length - 1
              ]
            : null;

        const nextCheckpoint =
          timeline.find(
            (item) => item.status === "pending"
          ) || null;

        return {
          attendeeId,
          fullName: attendee.full_name,
          registrationNumber:
            attendee.registration_number,
          groupValue: attendee.group_value,
          isDisqualified:
            attendee.is_disqualified === true,
          passedCheckpoints:
            passedTimeline.length,
          totalCheckpoints:
            checkpoints.length,
          remainingCheckpoints: Math.max(
            0,
            checkpoints.length -
              passedTimeline.length
          ),
          progressPercent:
            checkpoints.length > 0
              ? Math.round(
                  (passedTimeline.length /
                    checkpoints.length) *
                    100
                )
              : 0,
          isComplete:
            checkpoints.length > 0 &&
            passedTimeline.length ===
              checkpoints.length,
          latestCheckpoint,
          nextCheckpoint,
          lastKnownPassageAt:
            latestCheckpoint?.passedAt || null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (
          a!.passedCheckpoints !==
          b!.passedCheckpoints
        ) {
          return (
            b!.passedCheckpoints -
            a!.passedCheckpoints
          );
        }

        const aTime = a!.lastKnownPassageAt
          ? new Date(
              a!.lastKnownPassageAt
            ).getTime()
          : 0;

        const bTime = b!.lastKnownPassageAt
          ? new Date(
              b!.lastKnownPassageAt
            ).getTime()
          : 0;

        return bTime - aTime;
      })
      .map((runner, index) => ({
        ...runner!,
        rank: index + 1,
      }));

    const stalledParticipants =
      stallThresholdMinutes === null
        ? []
        : runnerTracking
            .filter((runner) => {
              if (runner.isComplete) return false;
              if (!runner.lastKnownPassageAt) return false;

              const lastPassageMs = new Date(
                runner.lastKnownPassageAt
              ).getTime();

              if (!Number.isFinite(lastPassageMs)) {
                return false;
              }

              const minutesSinceLastPassage =
                Math.floor(
                  (now.getTime() - lastPassageMs) /
                    60_000
                );

              return (
                minutesSinceLastPassage >=
                stallThresholdMinutes
              );
            })
            .map((runner) => {
              const lastPassageMs = new Date(
                runner.lastKnownPassageAt as string
              ).getTime();

              return {
                attendeeId: runner.attendeeId,
                fullName: runner.fullName,
                registrationNumber:
                  runner.registrationNumber,
                groupValue: runner.groupValue,
                isDisqualified:
                  runner.isDisqualified,
                rank: runner.rank,
                passedCheckpoints:
                  runner.passedCheckpoints,
                remainingCheckpoints:
                  runner.remainingCheckpoints,
                progressPercent:
                  runner.progressPercent,
                latestCheckpoint:
                  runner.latestCheckpoint,
                nextCheckpoint:
                  runner.nextCheckpoint,
                lastKnownPassageAt:
                  runner.lastKnownPassageAt,
                minutesSinceLastPassage:
                  Math.max(
                    0,
                    Math.floor(
                      (now.getTime() -
                        lastPassageMs) /
                        60_000
                    )
                  ),
              };
            })
            .sort(
              (a, b) =>
                b.minutesSinceLastPassage -
                a.minutesSinceLastPassage
            );

    return noStore({
      success: true,
      generatedAt: nowIso,
      event: {
        title: event.name,
        shortName: event.short_name,
        slug: event.slug,
        eventDate: event.event_date,
        groupLabel: event.group_label || "Batch",
      },
      summary: {
        registeredAlumni: registeredAlumniResult.count || 0,
        checkedIn: checkedInResult.count || 0,
        pendingReview: pendingReviewResult.count || 0,
        guests: guestsResult.count || 0,
      },
      velocity: {
        last1Min: velocity1Result.count || 0,
        last5Min: velocity5Result.count || 0,
        last15Min: velocity15Result.count || 0,
      },
      topBatches,
      recentActivity: (recentActivityResult.data || []).map(
        (attendee) => ({
          id: attendee.id,
          fullName: attendee.full_name,
          groupValue: attendee.group_value,
          checkedInAt: attendee.checked_in_at,
          attendeeType:
            attendee.attendee_type_id === alumniType.id
              ? "alumni"
              : "guest",
        })
      ),
      scanner: {
        status: scannerStatus,
        lastCheckinAt,
        secondsSinceLastScan,
      },
      race: {
        totalCheckpoints: checkpoints.length,
        totalCheckpointPassages:
          totalCheckpointPassagesResult.count || 0,
        configuredStations: checkpointStations.length,
        activeStations: activeCheckpointStations.length,
        offlineStations: offlineCheckpointStations.length,
        trackedParticipants:
          runnerTracking.length,
        completedParticipants:
          runnerTracking.filter(
            (runner) => runner.isComplete
          ).length,
        stalledParticipants:
          stalledParticipants.length,
      },
      stalledDetection: {
        enabled:
          stallThresholdMinutes !== null,
        thresholdMinutes:
          stallThresholdMinutes,
        configurationKey:
          "EVENT_STALLED_RUNNER_MINUTES",
      },
      stalledParticipants,
      runnerTracking,
      checkpointSummary: checkpointMetrics,
      checkpointStations: checkpointStations.map((station) => {
        const checkpoint = station.checkpoint_id
          ? checkpointById.get(station.checkpoint_id)
          : null;

        const expiresAtMs = new Date(
          station.expires_at
        ).getTime();

        const isActive =
          station.status === "active" &&
          Number.isFinite(expiresAtMs) &&
          expiresAtMs > now.getTime();

        return {
          stationId: station.id,
          stationName: station.station_name,
          checkpointId: station.checkpoint_id,
          checkpointName:
            checkpoint?.checkpoint_name || null,
          checkpointNo:
            checkpoint?.checkpoint_no || null,
          status: isActive ? "online" : "offline",
          tokenStatus: station.status,
          expiresAt: station.expires_at,
          lastUsedAt: station.last_used_at,
        };
      }),
      recentCheckpointActivity:
        recentCheckpointPassages.map((passage) => {
          const attendee = attendeeById.get(
            passage.attendee_id
          );
          const checkpoint = checkpointById.get(
            passage.checkpoint_id
          );
          const station = stationById.get(
            passage.station_token_id
          );

          return {
            passageId: passage.id,
            attendeeId: passage.attendee_id,
            attendeeName:
              attendee?.full_name || "Unknown attendee",
            registrationNumber:
              attendee?.registration_number || null,
            checkpointId: passage.checkpoint_id,
            checkpointName:
              checkpoint?.checkpoint_name ||
              "Unknown checkpoint",
            checkpointNo:
              checkpoint?.checkpoint_no || null,
            stationId: passage.station_token_id,
            stationName:
              station?.station_name || "Unknown station",
            passedAt: passage.passed_at,
          };
        }),
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Dashboard load failed.",
      },
      500
    );
  }
}
