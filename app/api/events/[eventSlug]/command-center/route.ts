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

    const { data: primaryAttendeeType, error: primaryAttendeeTypeError } =
      await supabase
        .from("event_attendee_types")
        .select("id,type_key,type_label")
        .eq("event_id", event.id)
        .eq("is_primary", true)
        .maybeSingle();

    if (primaryAttendeeTypeError) {
      throw new Error(primaryAttendeeTypeError.message);
    }

    if (!primaryAttendeeType?.id) {
      return noStore(
        {
          success: false,
          error:
            "Primary attendee type is not configured for this event.",
        },
        500
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();

    const [
      registeredPrimaryResult,
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
        .eq("attendee_type_id", primaryAttendeeType.id)
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
        .eq("attendee_type_id", primaryAttendeeType.id)
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
      registeredPrimaryResult,
      "Registered primary attendee count failed."
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

    // Shared by runnerTracking and participantLookup so both derive the
    // same checkpoint timeline from the same source data - this was
    // previously computed inline only for runnerTracking, discarded after
    // deriving latestCheckpoint/nextCheckpoint, and never returned to the
    // client (EVT-020-adjacent AUG21-005 extension: Stage 1 fix).
    type CheckpointTimelineEntry =
      | {
          checkpointId: string;
          checkpointNo: number;
          checkpointName: string;
          sortOrder: number;
          sequence: number;
          status: "passed";
          passedAt: string;
        }
      | {
          checkpointId: string;
          checkpointNo: number;
          checkpointName: string;
          sortOrder: number;
          sequence: number;
          status: "pending";
          passedAt: null;
        };

    function buildCheckpointTimeline(
      passages: RecentPassageRow[]
    ) {
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

      // Built via explicit branching, not a ternary sharing one object
      // shape, so each branch's literal "passed"/"pending" status and its
      // paired passedAt type (string vs. null) are preserved as a real
      // discriminated union - matching the frontend's
      // PassedCheckpointTimelineItem / PendingCheckpointTimelineItem
      // pattern (Stage 3). The previous inline-ternary version produced a
      // single flat inferred type where status and passedAt were
      // independently typed (status: "passed" | "pending", passedAt:
      // string | null), so filtering by status !== "passed" did not
      // narrow passedAt to non-null - this caused a real build failure
      // once Stage 8 read .passedAt after such a filter.
      const timeline: CheckpointTimelineEntry[] =
        checkpoints.map((checkpoint, index) => {
          const passage =
            uniquePassageByCheckpoint.get(
              checkpoint.id
            );

          if (passage) {
            return {
              checkpointId: checkpoint.id,
              checkpointNo:
                checkpoint.checkpoint_no,
              checkpointName:
                checkpoint.checkpoint_name,
              sortOrder:
                checkpoint.sort_order,
              sequence: index + 1,
              status: "passed",
              passedAt: passage.passed_at,
            };
          }

          return {
            checkpointId: checkpoint.id,
            checkpointNo:
              checkpoint.checkpoint_no,
            checkpointName:
              checkpoint.checkpoint_name,
            sortOrder:
              checkpoint.sort_order,
            sequence: index + 1,
            status: "pending",
            passedAt: null,
          };
        });

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
        timeline,
        passedTimeline,
        latestCheckpoint,
        nextCheckpoint,
      };
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

        const {
          timeline,
          passedTimeline,
          latestCheckpoint,
          nextCheckpoint,
        } = buildCheckpointTimeline(passages);

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
          timeline,
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

    // participantLookup is deliberately sourced from event_attendees, not
    // from allCheckpointPassages / trackingAttendeeIds like runnerTracking
    // above. runnerTracking only contains attendees who have at least one
    // recorded checkpoint passage - a registered or checked-in participant
    // who has not yet passed START (or any checkpoint) is invisible to it.
    // For a safety/lookup tool that must be able to find anyone on the
    // roster, that gap is not acceptable (AUG21-005 extension, Stage 2).
    const rosterAttendeesResult = await supabase
      .from("event_attendees")
      .select(
        "id,full_name,registration_number,group_value,attendance_status,checked_in_at,is_disqualified"
      )
      .eq("event_id", event.id)
      .is("merged_into", null);

    throwIfError(
      rosterAttendeesResult,
      "Participant roster query failed."
    );

    const participantLookup = (
      rosterAttendeesResult.data || []
    ).map((attendee) => {
      const passages =
        passagesByAttendee.get(attendee.id) || [];

      const { timeline, latestCheckpoint } =
        buildCheckpointTimeline(passages);

      return {
        attendeeId: attendee.id,
        fullName: attendee.full_name,
        registrationNumber:
          attendee.registration_number,
        groupValue: attendee.group_value,
        attendanceStatus:
          attendee.attendance_status,
        checkedInAt: attendee.checked_in_at,
        isDisqualified:
          attendee.is_disqualified === true,
        latestCheckpoint,
        lastKnownPassageAt:
          latestCheckpoint?.passedAt || null,
        timeline,
      };
    });

    // Stage 8 - checkpoint anomaly detection.
    //
    // Only two anomaly types are implemented. Duplicate scans and repeat
    // scans after completion are already prevented atomically by
    // record_event_checkpoint_passage's
    // ON CONFLICT (checkpoint_id, attendee_id) DO NOTHING (confirmed via
    // direct pg_proc inspection of the live function, not assumed from the
    // calling route). Invalid station/checkpoint pairing is structurally
    // impossible at scan time: a station token's checkpoint_id is fixed at
    // issuance and read server-side (requireEventStation.ts), never
    // supplied by the scanning client. None of those three need dashboard
    // detection.
    //
    // Reuses the checkpointById map already built above for
    // recentCheckpointActivity/checkpointStations - not redeclared here.

    type CheckpointAnomalyRef = {
      checkpointId: string;
      checkpointNo: number;
      checkpointName: string;
      sortOrder: number;
      passedAt: string;
    };

    type CheckpointAnomalyItem =
      | {
          anomalyType: "skipped_checkpoint";
          attendeeId: string;
          fullName: string;
          registrationNumber: string | null;
          detectedAt: string;
          passedCheckpoint: CheckpointAnomalyRef;
          missingCheckpoints: Omit<
            CheckpointAnomalyRef,
            "passedAt"
          >[];
        }
      | {
          anomalyType: "out_of_order";
          attendeeId: string;
          fullName: string;
          registrationNumber: string | null;
          detectedAt: string;
          earlierRecordedPassage: CheckpointAnomalyRef;
          laterRecordedPassage: CheckpointAnomalyRef;
        };

    const checkpointAnomalies: CheckpointAnomalyItem[] = [];

    for (const runner of runnerTracking) {
      const attendee = trackingAttendeeById.get(
        runner.attendeeId
      );

      if (!attendee) {
        continue;
      }

      // Skipped checkpoint: for every passed checkpoint, flag it if any
      // earlier-in-course-order checkpoint is still pending. Uses the
      // already-computed, sort_order-ordered timeline - no new query.
      for (const passedItem of runner.timeline) {
        if (passedItem.status !== "passed") continue;

        const passedAt = passedItem.passedAt;

        if (!passedAt) continue;

        const missingCheckpoints = runner.timeline.filter(
          (item) =>
            item.status === "pending" &&
            item.sortOrder < passedItem.sortOrder
        );

        if (missingCheckpoints.length > 0) {
          checkpointAnomalies.push({
            anomalyType: "skipped_checkpoint",
            attendeeId: runner.attendeeId,
            fullName: attendee.full_name,
            registrationNumber:
              attendee.registration_number,
            detectedAt: passedAt,
            passedCheckpoint: {
              checkpointId: passedItem.checkpointId,
              checkpointNo: passedItem.checkpointNo,
              checkpointName: passedItem.checkpointName,
              sortOrder: passedItem.sortOrder,
              passedAt,
            },
            missingCheckpoints: missingCheckpoints.map(
              (item) => ({
                checkpointId: item.checkpointId,
                checkpointNo: item.checkpointNo,
                checkpointName: item.checkpointName,
                sortOrder: item.sortOrder,
              })
            ),
          });
        }
      }

      // Out-of-order passage: sort this attendee's raw passages
      // chronologically, track the highest checkpoint sort_order recorded
      // so far, flag any passage whose checkpoint sort_order is lower than
      // a checkpoint already recorded earlier in time.
      const passages = (
        passagesByAttendee.get(runner.attendeeId) || []
      )
        .slice()
        .sort(
          (a, b) =>
            new Date(a.passed_at).getTime() -
            new Date(b.passed_at).getTime()
        );

      let highestSoFar: {
        checkpoint: CheckpointRow;
        passedAt: string;
      } | null = null;

      for (const passage of passages) {
        const checkpoint = checkpointById.get(
          passage.checkpoint_id
        );

        if (!checkpoint) continue;

        if (
          highestSoFar &&
          checkpoint.sort_order <
            highestSoFar.checkpoint.sort_order
        ) {
          checkpointAnomalies.push({
            anomalyType: "out_of_order",
            attendeeId: runner.attendeeId,
            fullName: attendee.full_name,
            registrationNumber:
              attendee.registration_number,
            detectedAt: passage.passed_at,
            earlierRecordedPassage: {
              checkpointId:
                highestSoFar.checkpoint.id,
              checkpointNo:
                highestSoFar.checkpoint
                  .checkpoint_no,
              checkpointName:
                highestSoFar.checkpoint
                  .checkpoint_name,
              sortOrder:
                highestSoFar.checkpoint.sort_order,
              passedAt: highestSoFar.passedAt,
            },
            laterRecordedPassage: {
              checkpointId: checkpoint.id,
              checkpointNo: checkpoint.checkpoint_no,
              checkpointName:
                checkpoint.checkpoint_name,
              sortOrder: checkpoint.sort_order,
              passedAt: passage.passed_at,
            },
          });
        }

        if (
          !highestSoFar ||
          checkpoint.sort_order >
            highestSoFar.checkpoint.sort_order
        ) {
          highestSoFar = {
            checkpoint,
            passedAt: passage.passed_at,
          };
        }
      }
    }

    const stalledParticipants =
      stallThresholdMinutes === null
        ? []
        : runnerTracking
            .filter((runner) => {
              // Stage 6 correction: completed and disqualified runners
              // never belong here, and a runner with no nextCheckpoint has
              // either finished (already excluded by isComplete above, but
              // checked explicitly for safety) or the event has zero
              // configured checkpoints - neither is a "stalled between
              // checkpoints" case.
              if (runner.isComplete) return false;
              if (runner.isDisqualified) return false;
              if (!runner.lastKnownPassageAt) return false;
              if (!runner.nextCheckpoint) return false;

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
                // nextCheckpoint is kept temporarily alongside
                // expectedNextCheckpoint (same value) so existing callers
                // are not broken by the rename. Remove nextCheckpoint here
                // once the frontend migration to expectedNextCheckpoint is
                // confirmed complete (Stage 6 follow-up, not this change).
                nextCheckpoint:
                  runner.nextCheckpoint,
                expectedNextCheckpoint:
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
                thresholdMinutes: stallThresholdMinutes,
                // Every item in this array satisfies the overdue filter
                // above by construction - this field exists so the
                // frontend has an explicit boolean to key off rather than
                // re-deriving it from minutesSinceLastPassage vs.
                // thresholdMinutes itself.
                isOverdue: true,
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
        registeredAlumni: registeredPrimaryResult.count || 0,
        registeredParticipants: registeredPrimaryResult.count || 0,
        primaryAttendeeType: primaryAttendeeType.type_key,
        primaryAttendeeLabel: primaryAttendeeType.type_label,
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
            attendee.attendee_type_id === primaryAttendeeType.id
              ? primaryAttendeeType.type_key
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
      participantLookup,
      checkpointAnomalies,
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
