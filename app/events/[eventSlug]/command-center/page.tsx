"use client";

import * as React from "react";
import { useParams } from "next/navigation";

type CheckpointTimelineBase = {
  checkpointId: string;
  checkpointNo: number;
  checkpointName: string;
  sortOrder: number;
  sequence: number;
};

type PassedCheckpointTimelineItem = CheckpointTimelineBase & {
  status: "passed";
  passedAt: string;
};

type PendingCheckpointTimelineItem = CheckpointTimelineBase & {
  status: "pending";
  passedAt: null;
};

type CheckpointTimelineItem =
  | PassedCheckpointTimelineItem
  | PendingCheckpointTimelineItem;

type RunnerTrackingItem = {
  rank: number;
  attendeeId: string;
  fullName: string;
  registrationNumber: string | null;
  groupValue: string | null;
  isDisqualified: boolean;
  passedCheckpoints: number;
  totalCheckpoints: number;
  remainingCheckpoints: number;
  progressPercent: number;
  isComplete: boolean;
  timeline: CheckpointTimelineItem[];
  latestCheckpoint: PassedCheckpointTimelineItem | null;
  nextCheckpoint: PendingCheckpointTimelineItem | null;
  lastKnownPassageAt: string | null;
};

type StalledParticipantItem = {
  attendeeId: string;
  fullName: string;
  registrationNumber: string | null;
  groupValue: string | null;
  isDisqualified: boolean;
  rank: number;
  passedCheckpoints: number;
  remainingCheckpoints: number;
  progressPercent: number;
  latestCheckpoint: PassedCheckpointTimelineItem | null;
  // nextCheckpoint is kept temporarily alongside expectedNextCheckpoint
  // (same value from the backend) during the Stage 6 rename migration -
  // prefer expectedNextCheckpoint in new code.
  nextCheckpoint: PendingCheckpointTimelineItem | null;
  expectedNextCheckpoint: PendingCheckpointTimelineItem | null;
  lastKnownPassageAt: string | null;
  minutesSinceLastPassage: number;
  thresholdMinutes: number;
  isOverdue: boolean;
};

// participantLookup deliberately has no nextCheckpoint field - it is
// sourced from the full event_attendees roster (EVT-020-adjacent AUG21-005
// extension, Stage 2), not from runnerTracking, and is not filtered by
// primary attendee type (guests remain findable on the safety roster).
type ParticipantLookupItem = {
  attendeeId: string;
  fullName: string;
  registrationNumber: string | null;
  groupValue: string | null;
  attendanceStatus: string | null;
  checkedInAt: string | null;
  isDisqualified: boolean;
  latestCheckpoint: PassedCheckpointTimelineItem | null;
  lastKnownPassageAt: string | null;
  timeline: CheckpointTimelineItem[];
};

type DashboardResponse = {
  success: boolean;
  generatedAt?: string;
  event?: {
    title: string;
    shortName?: string | null;
    slug: string;
    eventDate?: string | null;
    groupLabel: string;
  };
  summary?: {
    // registeredAlumni is kept for backward compatibility with existing UI
    // that reads it directly; registeredParticipants is the neutral name
    // for the same count (Stage 2.5E). Both currently always carry the
    // same value - the primary-attendee-type count, whatever that type is
    // for this event (alumni, participant, etc - see primaryAttendeeType
    // below, a flat string, not a nested object).
    registeredAlumni: number;
    registeredParticipants: number;
    primaryAttendeeType: string;
    primaryAttendeeLabel: string;
    checkedIn: number;
    pendingReview: number;
    guests: number;
  };
  velocity?: {
    last1Min: number;
    last5Min: number;
    last15Min: number;
  };
  topBatches?: {
    value: string;
    count: number;
  }[];
  recentActivity?: {
    id: string;
    fullName: string;
    groupValue: string | null;
    checkedInAt: string | null;
    // Not a fixed "alumni" | "guest" union: this is the event's actual
    // primary attendee type_key (e.g. "alumni", "participant") when the
    // attendee is the primary type, otherwise "guest". Still a binary
    // classification as of Stage 2.5E - a third configured attendee type
    // (e.g. "volunteer") would currently also be reported as "guest".
    // Known limitation, not yet generalized; see Stage 2.5E notes.
    attendeeType: string;
  }[];
  scanner?: {
    status: "online" | "idle" | "unknown";
    lastCheckinAt: string | null;
    secondsSinceLastScan: number | null;
  };
  race?: {
    totalCheckpoints: number;
    totalCheckpointPassages: number;
    configuredStations: number;
    activeStations: number;
    offlineStations: number;
    trackedParticipants: number;
    completedParticipants: number;
    stalledParticipants: number;
  };
  stalledDetection?: {
    enabled: boolean;
    thresholdMinutes: number | null;
    configurationKey: string;
  };
  checkpointSummary?: {
    checkpointId: string;
    checkpointName: string;
    checkpointNo: number;
    sortOrder: number;
    passages: number;
    lastPassageAt: string | null;
  }[];
  checkpointStations?: {
    stationId: string;
    stationName: string;
    checkpointId: string | null;
    checkpointName: string | null;
    checkpointNo: number | null;
    status: "online" | "offline";
    tokenStatus: string;
    expiresAt: string;
    lastUsedAt: string | null;
  }[];
  recentCheckpointActivity?: {
    passageId: string;
    attendeeId: string;
    attendeeName: string;
    registrationNumber: string | null;
    checkpointId: string;
    checkpointName: string;
    checkpointNo: number | null;
    stationId: string;
    stationName: string;
    passedAt: string;
  }[];
  stalledParticipants?: StalledParticipantItem[];
  runnerTracking?: RunnerTrackingItem[];
  participantLookup?: ParticipantLookupItem[];
  error?: string;
};

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("en-PH").format(Number(value || 0));
}

function formatTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function formatGenerated(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function secondsAgo(value: number | null | undefined) {
  if (value === null || value === undefined) return "No scan yet";
  if (value < 60) return `${value}s ago`;
  const minutes = Math.floor(value / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function relativeTime(value: string | null | undefined) {
  if (!value) return "No activity yet";

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "-";

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function scannerBadgeClass(status: string | undefined) {
  if (status === "online") {
    return "border-emerald-300 bg-emerald-100 text-emerald-800";
  }

  if (status === "idle") {
    return "border-amber-300 bg-amber-100 text-amber-900";
  }

  return "border-slate-300 bg-slate-100 text-slate-700";
}

function scannerLabel(status: string | undefined) {
  if (status === "online") return "ONLINE";
  if (status === "idle") return "IDLE";
  return "UNKNOWN";
}

function stationBadgeClass(status: "online" | "offline") {
  return status === "online"
    ? "border-emerald-300 bg-emerald-100 text-emerald-800"
    : "border-red-300 bg-red-100 text-red-800";
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.max(
    0,
    Math.min(100, Math.round((numerator / denominator) * 100))
  );
}

// Stage 7 - display-only severity tier for the Missing Between Checkpoints
// panel. Not a new overdue computation: every runner passed to this
// function is already confirmed overdue by the backend filter
// (stalledParticipants). This only decides how loudly to show it, based
// on how far past the threshold the elapsed time already is.
function stalledSeverity(
  minutesSinceLastPassage: number,
  thresholdMinutes: number
): "moderate" | "severe" {
  if (!thresholdMinutes) return "moderate";
  return minutesSinceLastPassage >= thresholdMinutes * 2
    ? "severe"
    : "moderate";
}

function ratePerMinute(count: number, minutes: number) {
  if (!minutes) return "0.0";
  return (count / minutes).toFixed(1);
}

export default function EventCommandCenterPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  const [data, setData] = React.useState<DashboardResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");

  // Stage 4 - Runner Safety Lookup
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedParticipantId, setSelectedParticipantId] =
    React.useState<string | null>(null);

  // Stage 5 - expandable timeline per row in the Runner Tracking table
  const [expandedRunnerIds, setExpandedRunnerIds] = React.useState<
    Set<string>
  >(new Set());

  function toggleRunnerExpanded(attendeeId: string) {
    setExpandedRunnerIds((current) => {
      const next = new Set(current);

      if (next.has(attendeeId)) {
        next.delete(attendeeId);
      } else {
        next.add(attendeeId);
      }

      return next;
    });
  }

  async function loadDashboard(background = false) {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");

    try {
      const res = await fetch(`/api/events/${eventSlug}/command-center`, {
        cache: "no-store",
      });

      const next = (await res.json()) as DashboardResponse;

      if (!res.ok || !next.success) {
        throw new Error(next.error || "Dashboard failed to load.");
      }

      setData(next);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Dashboard failed to load."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  React.useEffect(() => {
    if (!eventSlug) return;

    void loadDashboard(false);

    const timer = window.setInterval(() => {
      void loadDashboard(true);
    }, 10000);

    return () => window.clearInterval(timer);
  }, [eventSlug]);

  const event = data?.event;

  const summary = data?.summary || {
    registeredAlumni: 0,
    registeredParticipants: 0,
    primaryAttendeeType: "",
    primaryAttendeeLabel: "Participant",
    checkedIn: 0,
    pendingReview: 0,
    guests: 0,
  };

  const velocity = data?.velocity || {
    last1Min: 0,
    last5Min: 0,
    last15Min: 0,
  };

  const race = data?.race || {
    totalCheckpoints: 0,
    totalCheckpointPassages: 0,
    configuredStations: 0,
    activeStations: 0,
    offlineStations: 0,
    trackedParticipants: 0,
    completedParticipants: 0,
    stalledParticipants: 0,
  };

  const topBatches = data?.topBatches || [];
  const recentActivity = data?.recentActivity || [];
  const scanner = data?.scanner;
  const checkpointSummary = data?.checkpointSummary || [];
  const checkpointStations = data?.checkpointStations || [];
  const recentCheckpointActivity =
    data?.recentCheckpointActivity || [];
  const runnerTracking = data?.runnerTracking || [];
  // Rendered as the "Missing Between Checkpoints" panel (Stage 6). The
  // internal field name stays stalledParticipants - only the displayed
  // title uses the operational wording, per the decision to correct and
  // reuse this existing computation rather than add a parallel one.
  const stalledParticipants = data?.stalledParticipants || [];
  const stalledDetection = data?.stalledDetection;

  const checkInPct = percent(
    summary.checkedIn,
    summary.registeredAlumni + summary.guests
  );

  const maxBatchCount = Math.max(
    1,
    ...topBatches.map((item) => item.count)
  );

  const maxCheckpointPassages = Math.max(
    1,
    ...checkpointSummary.map((item) => item.passages)
  );

  const participantLookup = data?.participantLookup || [];

  // Stage 4A - filter the full roster by name or registration number.
  // Deliberately reads from participantLookup, not runnerTracking, so
  // participants with zero checkpoint passages (including never checked
  // in) remain findable.
  const filteredParticipants = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return [];
    }

    return participantLookup
      .filter((participant) => {
        const nameMatch = participant.fullName
          .toLowerCase()
          .includes(query);

        const regNumberMatch = (
          participant.registrationNumber || ""
        )
          .toLowerCase()
          .includes(query);

        return nameMatch || regNumberMatch;
      })
      .slice(0, 50);
  }, [participantLookup, searchQuery]);

  const selectedParticipant =
    participantLookup.find(
      (participant) =>
        participant.attendeeId === selectedParticipantId
    ) || null;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <section className="mx-auto max-w-7xl">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
                JRide Events
              </p>
              <h1 className="mt-3 text-4xl font-black">
                {event?.title || "Event Operations Dashboard"}
              </h1>
              <p className="mt-2 text-slate-300">
                Live attendance and race operations for {eventSlug}.
              </p>
              {data?.generatedAt ? (
                <p className="mt-2 text-sm font-semibold text-slate-500">
                  Last updated: {formatGenerated(data.generatedAt)}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-3">
              {refreshing ? (
                <span className="rounded-2xl border border-slate-700 px-4 py-3 text-sm font-black text-slate-300">
                  Refreshing...
                </span>
              ) : null}

              <button
                type="button"
                onClick={() => loadDashboard(false)}
                className="rounded-2xl bg-amber-400 px-5 py-4 font-black text-slate-950"
              >
                Refresh
              </button>
            </div>
          </div>

          {loading ? (
            <div className="mt-6 rounded-3xl bg-slate-950 p-6">
              <p className="text-xl font-black">Loading dashboard...</p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-6 rounded-3xl bg-red-100 p-6 text-red-800">
              <p className="text-xl font-black">Dashboard Error</p>
              <p className="mt-2 font-semibold">{error}</p>
            </div>
          ) : null}

          {!loading && !error ? (
            <>
              <div className="mt-6 rounded-3xl border border-amber-300/20 bg-slate-950 p-5">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.25em] text-amber-300">
                      Race Command Center
                    </p>
                    <h2 className="mt-2 text-3xl font-black">
                      Live checkpoint operations
                    </h2>
                  </div>
                  <p className="text-sm font-semibold text-slate-400">
                    Auto-refresh every 10 seconds
                  </p>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-5">
                  <div className="rounded-3xl bg-white p-5 text-slate-950">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                      Checkpoints
                    </p>
                    <p className="mt-3 text-5xl font-black">
                      {formatNumber(race.totalCheckpoints)}
                    </p>
                  </div>

                  <div className="rounded-3xl bg-cyan-100 p-5 text-cyan-950">
                    <p className="text-xs font-black uppercase tracking-[0.2em]">
                      Total Passages
                    </p>
                    <p className="mt-3 text-5xl font-black">
                      {formatNumber(race.totalCheckpointPassages)}
                    </p>
                  </div>

                  <div className="rounded-3xl bg-slate-100 p-5 text-slate-950">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                      Configured Stations
                    </p>
                    <p className="mt-3 text-5xl font-black">
                      {formatNumber(race.configuredStations)}
                    </p>
                  </div>

                  <div className="rounded-3xl bg-emerald-100 p-5 text-emerald-900">
                    <p className="text-xs font-black uppercase tracking-[0.2em]">
                      Active Stations
                    </p>
                    <p className="mt-3 text-5xl font-black">
                      {formatNumber(race.activeStations)}
                    </p>
                  </div>

                  <div className="rounded-3xl bg-red-100 p-5 text-red-800">
                    <p className="text-xs font-black uppercase tracking-[0.2em]">
                      Offline Stations
                    </p>
                    <p className="mt-3 text-5xl font-black">
                      {formatNumber(race.offlineStations)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-2">
                <div className="rounded-3xl bg-white p-5 text-slate-950">
                  <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                        Checkpoint Progress
                      </p>
                      <h2 className="mt-2 text-3xl font-black">
                        Passage totals
                      </h2>
                    </div>
                    <p className="text-sm font-semibold text-slate-500">
                      Ordered by checkpoint sequence
                    </p>
                  </div>

                  {checkpointSummary.length > 0 ? (
                    <div className="mt-5 grid gap-3">
                      {checkpointSummary.map((checkpoint) => (
                        <div
                          key={checkpoint.checkpointId}
                          className="rounded-2xl bg-slate-100 p-4"
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                                Checkpoint {checkpoint.checkpointNo}
                              </p>
                              <p className="mt-1 text-xl font-black">
                                {checkpoint.checkpointName}
                              </p>
                              <p className="mt-2 text-sm font-semibold text-slate-500">
                                Last passage:{" "}
                                {checkpoint.lastPassageAt
                                  ? `${relativeTime(
                                      checkpoint.lastPassageAt
                                    )} at ${formatTime(
                                      checkpoint.lastPassageAt
                                    )}`
                                  : "No passage yet"}
                              </p>
                            </div>

                            <p className="font-mono text-4xl font-black">
                              {formatNumber(checkpoint.passages)}
                            </p>
                          </div>

                          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-cyan-500"
                              style={{
                                width: `${
                                  checkpoint.passages > 0
                                    ? Math.max(
                                        6,
                                        Math.round(
                                          (checkpoint.passages /
                                            maxCheckpointPassages) *
                                            100
                                        )
                                      )
                                    : 0
                                }%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-5 rounded-2xl bg-slate-100 p-4 font-semibold text-slate-500">
                      No checkpoints configured for this event.
                    </p>
                  )}
                </div>

                <div className="rounded-3xl bg-white p-5 text-slate-950">
                  <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                        Station Health
                      </p>
                      <h2 className="mt-2 text-3xl font-black">
                        Checkpoint devices
                      </h2>
                    </div>
                    <p className="text-sm font-semibold text-slate-500">
                      Status is based on token state and expiry
                    </p>
                  </div>

                  {checkpointStations.length > 0 ? (
                    <div className="mt-5 grid gap-3">
                      {checkpointStations.map((station) => (
                        <div
                          key={station.stationId}
                          className="rounded-2xl bg-slate-100 p-4"
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <p className="text-xl font-black">
                                {station.stationName}
                              </p>
                              <p className="mt-1 text-sm font-semibold text-slate-500">
                                {station.checkpointNo
                                  ? `Checkpoint ${station.checkpointNo} - `
                                  : ""}
                                {station.checkpointName ||
                                  "No checkpoint assignment"}
                              </p>
                            </div>

                            <span
                              className={`rounded-full border px-4 py-2 text-xs font-black ${stationBadgeClass(
                                station.status
                              )}`}
                            >
                              {station.status.toUpperCase()}
                            </span>
                          </div>

                          <div className="mt-4 grid gap-2 text-sm md:grid-cols-2">
                            <div className="rounded-xl bg-white p-3">
                              <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
                                Last Used
                              </p>
                              <p className="mt-1 font-bold">
                                {station.lastUsedAt
                                  ? `${relativeTime(
                                      station.lastUsedAt
                                    )} at ${formatTime(
                                      station.lastUsedAt
                                    )}`
                                  : "Never"}
                              </p>
                            </div>

                            <div className="rounded-xl bg-white p-3">
                              <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
                                Token
                              </p>
                              <p className="mt-1 font-bold">
                                {station.tokenStatus} - expires{" "}
                                {formatGenerated(station.expiresAt)}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-5 rounded-2xl bg-slate-100 p-4 font-semibold text-slate-500">
                      No checkpoint station tokens configured.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5 rounded-3xl bg-white p-5 text-slate-950">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                      Live Checkpoint Feed
                    </p>
                    <h2 className="mt-2 text-3xl font-black">
                      Recent runner passages
                    </h2>
                  </div>
                  <p className="text-sm font-semibold text-slate-500">
                    Latest 20 checkpoint records
                  </p>
                </div>

                {recentCheckpointActivity.length > 0 ? (
                  <div className="mt-5 grid gap-3">
                    {recentCheckpointActivity.map((passage) => (
                      <div
                        key={passage.passageId}
                        className="flex flex-col gap-3 rounded-2xl bg-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between"
                      >
                        <div>
                          <p className="text-xl font-black">
                            {passage.attendeeName}
                          </p>
                          <p className="mt-1 font-mono text-sm font-bold text-slate-500">
                            {passage.registrationNumber || "-"}
                          </p>
                        </div>

                        <div className="lg:text-center">
                          <p className="text-sm font-black text-slate-500">
                            Checkpoint {passage.checkpointNo || "-"}
                          </p>
                          <p className="mt-1 font-black">
                            {passage.checkpointName}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-500">
                            {passage.stationName}
                          </p>
                        </div>

                        <div className="lg:text-right">
                          <p className="font-mono text-lg font-black">
                            {formatTime(passage.passedAt)}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-500">
                            {relativeTime(passage.passedAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-5 rounded-2xl bg-slate-100 p-4 font-semibold text-slate-500">
                    No checkpoint passages yet.
                  </p>
                )}
              </div>

              <div
                id="runner-safety-lookup"
                className="mt-5 rounded-3xl bg-white p-5 text-slate-950"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                      Runner Safety Lookup
                    </p>
                    <h2 className="mt-2 text-3xl font-black">
                      Find a participant
                    </h2>
                  </div>
                  <p className="text-sm font-semibold text-slate-500">
                    Searches the full roster, including anyone with no
                    checkpoint passage yet
                  </p>
                </div>

                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name or registration number"
                  className="mt-5 w-full rounded-2xl border border-slate-200 bg-slate-100 p-4 text-base font-semibold text-slate-950 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none"
                />

                {searchQuery.trim() && (
                  <p className="mt-3 text-sm font-semibold text-slate-500">
                    {filteredParticipants.length} match
                    {filteredParticipants.length === 1 ? "" : "es"}
                  </p>
                )}

                {filteredParticipants.length > 0 ? (
                  <div className="mt-4 grid max-h-80 gap-2 overflow-y-auto">
                    {filteredParticipants.map((participant) => (
                      <button
                        key={participant.attendeeId}
                        type="button"
                        onClick={() =>
                          setSelectedParticipantId(
                            participant.attendeeId
                          )
                        }
                        className={`flex flex-col gap-1 rounded-2xl border p-4 text-left transition ${
                          participant.attendeeId ===
                          selectedParticipantId
                            ? "border-amber-400 bg-amber-50"
                            : "border-slate-200 bg-slate-100 hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-lg font-black">
                            {participant.fullName}
                          </p>
                          {participant.isDisqualified && (
                            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-black text-red-700">
                              DISQUALIFIED
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-sm font-bold text-slate-500">
                          {participant.registrationNumber ||
                            "No registration number"}
                        </p>
                        <p className="text-sm font-semibold text-slate-500">
                          {participant.attendanceStatus ===
                          "checked_in"
                            ? "Checked in"
                            : "Not checked in"}
                          {participant.latestCheckpoint
                            ? ` - furthest: ${participant.latestCheckpoint.checkpointName}`
                            : " - No checkpoint passage recorded"}
                        </p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-5 rounded-2xl bg-slate-100 p-4 font-semibold text-slate-500">
                    {searchQuery.trim()
                      ? "No matching participant found."
                      : "Enter a name or registration number to search the roster."}
                  </p>
                )}

                {selectedParticipant && (
                  <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">
                          Selected Participant
                        </p>
                        <h3 className="mt-1 text-2xl font-black">
                          {selectedParticipant.fullName}
                        </h3>
                        <p className="mt-1 font-mono text-sm font-bold text-slate-600">
                          {selectedParticipant.registrationNumber ||
                            "No registration number"}
                        </p>
                      </div>
                      {selectedParticipant.isDisqualified && (
                        <span className="rounded-full bg-red-100 px-4 py-2 text-xs font-black text-red-700">
                          DISQUALIFIED
                        </span>
                      )}
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl bg-white p-3">
                        <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
                          Group
                        </p>
                        <p className="mt-1 font-bold">
                          {selectedParticipant.groupValue || "-"}
                        </p>
                      </div>

                      <div className="rounded-xl bg-white p-3">
                        <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
                          Attendance Status
                        </p>
                        <p className="mt-1 font-bold">
                          {selectedParticipant.attendanceStatus ||
                            "unknown"}
                        </p>
                      </div>

                      <div className="rounded-xl bg-white p-3">
                        <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
                          Checked-in Time
                        </p>
                        <p className="mt-1 font-bold">
                          {selectedParticipant.checkedInAt
                            ? `${formatTime(
                                selectedParticipant.checkedInAt
                              )} (${relativeTime(
                                selectedParticipant.checkedInAt
                              )})`
                            : "Not checked in"}
                        </p>
                      </div>

                      <div className="rounded-xl bg-white p-3">
                        <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
                          Furthest Checkpoint
                        </p>
                        <p className="mt-1 font-bold">
                          {selectedParticipant.latestCheckpoint
                            ? selectedParticipant.latestCheckpoint
                                .checkpointName
                            : "No checkpoint passage recorded"}
                        </p>
                        {selectedParticipant.latestCheckpoint && (
                          <p className="mt-1 text-sm font-semibold text-slate-500">
                            {formatTime(
                              selectedParticipant.latestCheckpoint
                                .passedAt
                            )}{" "}
                            (
                            {relativeTime(
                              selectedParticipant.latestCheckpoint
                                .passedAt
                            )}
                            )
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-5">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">
                        Checkpoint Timeline
                      </p>
                      <div className="mt-3 grid gap-2">
                        {selectedParticipant.timeline.length > 0 ? (
                          selectedParticipant.timeline.map((item) => (
                            <div
                              key={item.checkpointId}
                              className={`flex items-center justify-between rounded-xl p-3 ${
                                item.status === "passed"
                                  ? "bg-emerald-100"
                                  : "bg-slate-100"
                              }`}
                            >
                              <div>
                                <p className="font-black">
                                  {item.checkpointName}
                                </p>
                                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                                  {item.status === "passed"
                                    ? "Passed"
                                    : "Pending"}
                                </p>
                              </div>
                              <p className="text-sm font-bold text-slate-600">
                                {item.status === "passed"
                                  ? `${formatTime(
                                      item.passedAt
                                    )} (${relativeTime(
                                      item.passedAt
                                    )})`
                                  : "-"}
                              </p>
                            </div>
                          ))
                        ) : (
                          <p className="rounded-xl bg-slate-100 p-3 font-semibold text-slate-500">
                            No checkpoints are configured for this
                            event.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-5 rounded-3xl bg-white p-5 text-slate-950">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                      Runner Tracking
                    </p>
                    <h2 className="mt-2 text-3xl font-black">
                      Last known checkpoint ranking
                    </h2>
                  </div>

                  <p className="text-sm font-semibold text-slate-500">
                    Checkpoint-based only. No GPS or ETA inference.
                  </p>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl bg-cyan-50 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.15em] text-cyan-800">
                      Tracked Participants
                    </p>
                    <p className="mt-2 text-4xl font-black">
                      {formatNumber(race.trackedParticipants)}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-emerald-50 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.15em] text-emerald-800">
                      Completed Participants
                    </p>
                    <p className="mt-2 text-4xl font-black">
                      {formatNumber(race.completedParticipants)}
                    </p>
                  </div>
                </div>

                {runnerTracking.length > 0 ? (
                  <div className="mt-5 overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-y-2 text-sm">
                      <thead>
                        <tr className="text-left text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                          <th className="px-3 py-2">Rank</th>
                          <th className="px-3 py-2">Runner</th>
                          <th className="px-3 py-2">Progress</th>
                          <th className="px-3 py-2">Latest Known</th>
                          <th className="px-3 py-2">Next</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Timeline</th>
                        </tr>
                      </thead>

                      <tbody>
                        {runnerTracking.map((runner) => (
                          <React.Fragment key={runner.attendeeId}>
                            <tr
                              id={`runner-row-${runner.attendeeId}`}
                              className="bg-slate-100 align-top"
                            >
                              <td className="rounded-l-2xl px-3 py-4 font-mono text-xl font-black">
                                #{runner.rank}
                              </td>

                              <td className="px-3 py-4">
                                <p className="text-lg font-black">
                                  {runner.fullName}
                                </p>
                                <p className="mt-1 font-mono text-xs font-bold text-slate-500">
                                  {runner.registrationNumber ||
                                    "No registration number"}
                                </p>
                                {runner.groupValue ? (
                                  <p className="mt-1 text-xs font-semibold text-slate-500">
                                    {event?.groupLabel || "Group"}{" "}
                                    {runner.groupValue}
                                  </p>
                                ) : null}
                              </td>

                              <td className="px-3 py-4">
                                <p className="text-xl font-black">
                                  {runner.progressPercent}%
                                </p>
                                <p className="mt-1 text-xs font-semibold text-slate-500">
                                  {runner.passedCheckpoints} passed,{" "}
                                  {runner.remainingCheckpoints}{" "}
                                  remaining
                                </p>
                                <div className="mt-2 h-2 w-36 overflow-hidden rounded-full bg-slate-200">
                                  <div
                                    className="h-full rounded-full bg-cyan-600"
                                    style={{
                                      width: `${runner.progressPercent}%`,
                                    }}
                                  />
                                </div>
                              </td>

                              <td className="px-3 py-4">
                                {runner.latestCheckpoint ? (
                                  <>
                                    <p className="font-black">
                                      CP{" "}
                                      {
                                        runner.latestCheckpoint
                                          .checkpointNo
                                      }{" "}
                                      -{" "}
                                      {
                                        runner.latestCheckpoint
                                          .checkpointName
                                      }
                                    </p>
                                    <p className="mt-1 text-xs font-semibold text-slate-500">
                                      {formatTime(
                                        runner.lastKnownPassageAt
                                      )}
                                    </p>
                                    <p className="mt-1 text-xs font-semibold text-slate-400">
                                      {relativeTime(
                                        runner.lastKnownPassageAt
                                      )}
                                    </p>
                                  </>
                                ) : (
                                  <p className="font-semibold text-slate-500">
                                    No passage yet
                                  </p>
                                )}
                              </td>

                              <td className="px-3 py-4">
                                {runner.nextCheckpoint ? (
                                  <p className="font-black">
                                    CP{" "}
                                    {
                                      runner.nextCheckpoint
                                        .checkpointNo
                                    }{" "}
                                    -{" "}
                                    {
                                      runner.nextCheckpoint
                                        .checkpointName
                                    }
                                  </p>
                                ) : (
                                  <p className="font-black text-emerald-700">
                                    Finished
                                  </p>
                                )}
                              </td>

                              <td className="px-3 py-4">
                                <span
                                  className={`inline-flex rounded-full border px-3 py-2 text-xs font-black ${
                                    runner.isDisqualified
                                      ? "border-red-300 bg-red-100 text-red-800"
                                      : runner.isComplete
                                      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                                      : "border-cyan-300 bg-cyan-100 text-cyan-900"
                                  }`}
                                >
                                  {runner.isDisqualified
                                    ? "REVIEW"
                                    : runner.isComplete
                                    ? "FINISHED"
                                    : "ACTIVE"}
                                </span>
                              </td>

                              <td className="rounded-r-2xl px-3 py-4">
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleRunnerExpanded(
                                      runner.attendeeId
                                    )
                                  }
                                  className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:border-slate-400"
                                >
                                  {expandedRunnerIds.has(
                                    runner.attendeeId
                                  )
                                    ? "Hide"
                                    : "Show"}
                                </button>
                              </td>
                            </tr>

                            {expandedRunnerIds.has(
                              runner.attendeeId
                            ) && (
                              <tr>
                                <td
                                  colSpan={7}
                                  className="rounded-2xl bg-white p-4"
                                >
                                  {runner.timeline.length > 0 ? (
                                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                      {runner.timeline.map((item) => (
                                        <div
                                          key={item.checkpointId}
                                          className={`rounded-xl p-3 ${
                                            item.status === "passed"
                                              ? "bg-emerald-100"
                                              : "bg-slate-100"
                                          }`}
                                        >
                                          <p className="font-black">
                                            {item.checkpointName}
                                          </p>
                                          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                                            {item.status === "passed"
                                              ? "Passed"
                                              : "Pending"}
                                          </p>
                                          <p className="mt-1 text-xs font-bold text-slate-600">
                                            {item.status === "passed"
                                              ? `${formatTime(
                                                  item.passedAt
                                                )} (${relativeTime(
                                                  item.passedAt
                                                )})`
                                              : "-"}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="font-semibold text-slate-500">
                                      No checkpoints are configured
                                      for this event.
                                    </p>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-5 rounded-2xl bg-slate-100 p-4 font-semibold text-slate-500">
                    No participant checkpoint passages recorded yet.
                  </p>
                )}
              </div>

              <div className="mt-5 rounded-3xl bg-white p-5 text-slate-950">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                      Checkpoint Evidence Only - No Location Estimation
                    </p>
                    <h2 className="mt-2 text-3xl font-black">
                      Missing Between Checkpoints
                    </h2>
                  </div>
                  <p className="text-sm font-semibold text-slate-500">
                    Runners past the configured threshold since their
                    last recorded checkpoint. Completed and disqualified
                    runners are excluded. Sorted most overdue first.
                  </p>
                </div>

                {!stalledDetection?.enabled ? (
                  <p className="mt-5 rounded-2xl bg-slate-100 p-4 font-semibold text-slate-500">
                    Overdue detection is not configured for this
                    event. Set the{" "}
                    <span className="font-mono text-xs">
                      {stalledDetection?.configurationKey ||
                        "EVENT_STALLED_RUNNER_MINUTES"}
                    </span>{" "}
                    environment variable to enable this panel.
                  </p>
                ) : stalledParticipants.length > 0 ? (
                  <div className="mt-5 overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-y-2 text-sm">
                      <thead>
                        <tr className="text-left text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                          <th className="px-3 py-2">Runner</th>
                          <th className="px-3 py-2">
                            Latest Checkpoint
                          </th>
                          <th className="px-3 py-2">
                            Expected Next
                          </th>
                          <th className="px-3 py-2">
                            Last Recorded Passage
                          </th>
                          <th className="px-3 py-2">
                            Elapsed vs Threshold
                          </th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Actions</th>
                        </tr>
                      </thead>

                      <tbody>
                        {stalledParticipants.map((runner) => {
                          const severity = stalledSeverity(
                            runner.minutesSinceLastPassage,
                            runner.thresholdMinutes
                          );

                          const rowClass =
                            severity === "severe"
                              ? "bg-red-50"
                              : "bg-amber-50";

                          const badgeClass =
                            severity === "severe"
                              ? "border-red-400 bg-red-100 text-red-800"
                              : "border-amber-400 bg-amber-100 text-amber-800";

                          const overdueRatio = Math.min(
                            100,
                            Math.round(
                              (runner.minutesSinceLastPassage /
                                Math.max(
                                  1,
                                  runner.thresholdMinutes
                                )) *
                                100
                            )
                          );

                          return (
                            <tr
                              key={runner.attendeeId}
                              className={`${rowClass} align-top`}
                            >
                              <td className="rounded-l-2xl px-3 py-4">
                                <p className="text-lg font-black">
                                  {runner.fullName}
                                </p>
                                <p className="mt-1 font-mono text-xs font-bold text-slate-500">
                                  {runner.registrationNumber ||
                                    "No registration number"}
                                </p>
                                {runner.groupValue ? (
                                  <p className="mt-1 text-xs font-semibold text-slate-500">
                                    {event?.groupLabel ||
                                      "Group"}{" "}
                                    {runner.groupValue}
                                  </p>
                                ) : null}
                              </td>

                              <td className="px-3 py-4">
                                {runner.latestCheckpoint ? (
                                  <p className="font-black">
                                    CP{" "}
                                    {
                                      runner.latestCheckpoint
                                        .checkpointNo
                                    }{" "}
                                    -{" "}
                                    {
                                      runner.latestCheckpoint
                                        .checkpointName
                                    }
                                  </p>
                                ) : (
                                  <p className="font-semibold text-slate-500">
                                    -
                                  </p>
                                )}
                              </td>

                              <td className="px-3 py-4">
                                {runner.expectedNextCheckpoint ? (
                                  <p className="font-black">
                                    CP{" "}
                                    {
                                      runner
                                        .expectedNextCheckpoint
                                        .checkpointNo
                                    }{" "}
                                    -{" "}
                                    {
                                      runner
                                        .expectedNextCheckpoint
                                        .checkpointName
                                    }
                                  </p>
                                ) : (
                                  <p className="font-semibold text-slate-500">
                                    -
                                  </p>
                                )}
                              </td>

                              <td className="px-3 py-4">
                                <p className="font-bold">
                                  {formatTime(
                                    runner.lastKnownPassageAt
                                  )}
                                </p>
                              </td>

                              <td className="px-3 py-4">
                                <p className="text-lg font-black">
                                  {runner.minutesSinceLastPassage}{" "}
                                  min{" "}
                                  <span className="text-xs font-semibold text-slate-500">
                                    / {runner.thresholdMinutes}{" "}
                                    min threshold
                                  </span>
                                </p>
                                <div className="mt-2 h-2 w-32 overflow-hidden rounded-full bg-slate-200">
                                  <div
                                    className={`h-full rounded-full ${
                                      severity === "severe"
                                        ? "bg-red-600"
                                        : "bg-amber-500"
                                    }`}
                                    style={{
                                      width: `${overdueRatio}%`,
                                    }}
                                  />
                                </div>
                              </td>

                              <td className="px-3 py-4">
                                <span
                                  className={`inline-flex rounded-full border px-3 py-2 text-xs font-black ${badgeClass}`}
                                >
                                  {severity === "severe"
                                    ? "SEVERELY OVERDUE"
                                    : "OVERDUE"}
                                </span>
                              </td>

                              <td className="rounded-r-2xl px-3 py-4">
                                <div className="flex flex-col gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setExpandedRunnerIds(
                                        (current) => {
                                          const next = new Set(
                                            current
                                          );
                                          next.add(
                                            runner.attendeeId
                                          );
                                          return next;
                                        }
                                      );
                                      document
                                        .getElementById(
                                          `runner-row-${runner.attendeeId}`
                                        )
                                        ?.scrollIntoView({
                                          behavior: "smooth",
                                          block: "center",
                                        });
                                    }}
                                    className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:border-slate-400"
                                  >
                                    View Timeline
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSearchQuery(
                                        runner.registrationNumber ||
                                          runner.fullName
                                      );
                                      setSelectedParticipantId(
                                        runner.attendeeId
                                      );
                                      document
                                        .getElementById(
                                          "runner-safety-lookup"
                                        )
                                        ?.scrollIntoView({
                                          behavior: "smooth",
                                          block: "start",
                                        });
                                    }}
                                    className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:border-slate-400"
                                  >
                                    Find in Lookup
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-5 rounded-2xl bg-emerald-50 p-4 font-semibold text-emerald-700">
                    No runners are currently overdue between
                    checkpoints.
                  </p>
                )}
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-4">
                <div className="rounded-3xl bg-white p-5 text-slate-950">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                    Registered Alumni
                  </p>
                  <p className="mt-3 text-5xl font-black">
                    {formatNumber(summary.registeredAlumni)}
                  </p>
                </div>

                <div className="rounded-3xl bg-emerald-100 p-5 text-emerald-900">
                  <p className="text-xs font-black uppercase tracking-[0.2em]">
                    Checked In Total
                  </p>
                  <p className="mt-3 text-5xl font-black">
                    {formatNumber(summary.checkedIn)}
                  </p>
                </div>

                <div className="rounded-3xl bg-amber-100 p-5 text-amber-900">
                  <p className="text-xs font-black uppercase tracking-[0.2em]">
                    Guests
                  </p>
                  <p className="mt-3 text-5xl font-black">
                    {formatNumber(summary.guests)}
                  </p>
                </div>

                <div className="rounded-3xl bg-red-100 p-5 text-red-800">
                  <p className="text-xs font-black uppercase tracking-[0.2em]">
                    Pending Review
                  </p>
                  <p className="mt-3 text-5xl font-black">
                    {formatNumber(summary.pendingReview)}
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-3xl bg-slate-950 p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                      Check-in Progress
                    </p>
                    <p className="mt-2 text-2xl font-black">
                      {checkInPct}% of registered alumni + guests baseline
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      This is an operational ratio only, not a population attendance percentage.
                    </p>
                  </div>

                  <div className="h-4 w-full overflow-hidden rounded-full bg-slate-800 md:max-w-md">
                    <div
                      className="h-full rounded-full bg-emerald-400"
                      style={{ width: `${checkInPct}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-5 lg:grid-cols-3">
                <div className="rounded-3xl bg-white p-5 text-slate-950">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                    Check-in Velocity
                  </p>

                  <div className="mt-5 grid gap-3">
                    <div className="rounded-2xl bg-slate-100 p-4">
                      <p className="text-sm font-black text-slate-500">
                        Last 1 minute
                      </p>
                      <p className="mt-1 text-4xl font-black">
                        {formatNumber(velocity.last1Min)}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-slate-100 p-4">
                      <p className="text-sm font-black text-slate-500">
                        Last 5 minutes
                      </p>
                      <p className="mt-1 text-4xl font-black">
                        {formatNumber(velocity.last5Min)}
                      </p>
                      <p className="mt-1 text-sm font-bold text-slate-500">
                        {ratePerMinute(velocity.last5Min, 5)} per minute
                      </p>
                    </div>

                    <div className="rounded-2xl bg-slate-100 p-4">
                      <p className="text-sm font-black text-slate-500">
                        Last 15 minutes
                      </p>
                      <p className="mt-1 text-4xl font-black">
                        {formatNumber(velocity.last15Min)}
                      </p>
                      <p className="mt-1 text-sm font-bold text-slate-500">
                        {ratePerMinute(velocity.last15Min, 15)} per minute
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl bg-white p-5 text-slate-950">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                        Scanner Status
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-500">
                        Single gate check-in
                      </p>
                    </div>

                    <div
                      className={`rounded-full border px-4 py-2 text-sm font-black ${scannerBadgeClass(
                        scanner?.status
                      )}`}
                    >
                      {scannerLabel(scanner?.status)}
                    </div>
                  </div>

                  <div className="mt-6 rounded-2xl bg-slate-100 p-5">
                    <p className="text-sm font-black text-slate-500">
                      Last Scan
                    </p>
                    <p className="mt-2 text-3xl font-black">
                      {secondsAgo(scanner?.secondsSinceLastScan)}
                    </p>
                    <p className="mt-2 text-sm font-bold text-slate-500">
                      {formatTime(scanner?.lastCheckinAt)}
                    </p>
                  </div>

                  <p className="mt-4 text-sm font-semibold text-slate-500">
                    Scanner status is inferred from the latest successful check-in.
                  </p>
                </div>

                <div className="rounded-3xl bg-white p-5 text-slate-950">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                    Top Batches Today
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-500">
                    Actual checked-in alumni counts only.
                  </p>

                  {topBatches.length > 0 ? (
                    <div className="mt-5 grid gap-3">
                      {topBatches.map((item) => (
                        <div key={item.value}>
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-black">
                              {event?.groupLabel || "Batch"} {item.value}
                            </p>
                            <p className="font-mono font-black">
                              {item.count}
                            </p>
                          </div>

                          <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-amber-400"
                              style={{
                                width: `${Math.max(
                                  8,
                                  Math.round(
                                    (item.count / maxBatchCount) * 100
                                  )
                                )}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-5 rounded-2xl bg-slate-100 p-4 font-semibold text-slate-500">
                      No checked-in alumni yet.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5 rounded-3xl bg-white p-5 text-slate-950">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                      Live Activity
                    </p>
                    <h2 className="mt-2 text-3xl font-black">
                      Recent Check-ins
                    </h2>
                  </div>

                  <p className="text-sm font-semibold text-slate-500">
                    Latest 20 successful check-ins
                  </p>
                </div>

                {recentActivity.length > 0 ? (
                  <div className="mt-5 grid gap-3">
                    {recentActivity.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-col gap-2 rounded-2xl bg-slate-100 p-4 md:flex-row md:items-center md:justify-between"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            {item.attendeeType === "guest" ? (
                              <span className="rounded-full bg-emerald-200 px-2 py-1 text-xs font-black text-emerald-900">
                                G
                              </span>
                            ) : null}

                            <p className="text-xl font-black">
                              {item.fullName}
                            </p>
                          </div>

                          <p className="mt-1 text-sm font-semibold text-slate-500">
                            {event?.groupLabel || "Batch"}{" "}
                            {item.groupValue || "-"}
                          </p>
                        </div>

                        <p className="font-mono text-lg font-black">
                          {formatTime(item.checkedInAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-5 rounded-2xl bg-slate-100 p-4 font-semibold text-slate-500">
                    No check-ins yet.
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
