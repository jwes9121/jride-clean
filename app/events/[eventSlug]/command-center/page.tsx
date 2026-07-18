"use client";

import * as React from "react";
import { useParams } from "next/navigation";

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
    registeredAlumni: number;
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
    attendeeType: "alumni" | "guest";
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
  runnerTracking?: {
    rank: number;
    attendeeId: string;
    fullName: string;
    registrationNumber: string;
    groupValue: string | null;
    isDisqualified: boolean;
    passedCheckpoints: number;
    totalCheckpoints: number;
    remainingCheckpoints: number;
    progressPercent: number;
    isComplete: boolean;
    latestCheckpoint: {
      checkpointId: string;
      checkpointNo: number;
      checkpointName: string;
      sortOrder: number;
      sequence: number;
      status: "passed";
      passedAt: string | null;
    } | null;
    nextCheckpoint: {
      checkpointId: string;
      checkpointNo: number;
      checkpointName: string;
      sortOrder: number;
      sequence: number;
      status: "pending";
      passedAt: null;
    } | null;
    lastKnownPassageAt: string | null;
  }[];
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
  };

  const topBatches = data?.topBatches || [];
  const recentActivity = data?.recentActivity || [];
  const scanner = data?.scanner;
  const checkpointSummary = data?.checkpointSummary || [];
  const checkpointStations = data?.checkpointStations || [];
  const recentCheckpointActivity =
    data?.recentCheckpointActivity || [];
  const runnerTracking = data?.runnerTracking || [];

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
                        </tr>
                      </thead>

                      <tbody>
                        {runnerTracking.map((runner) => (
                          <tr
                            key={runner.attendeeId}
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
                                {runner.registrationNumber}
                              </p>
                              {runner.groupValue ? (
                                <p className="mt-1 text-xs font-semibold text-slate-500">
                                  {event?.groupLabel || "Group"} {runner.groupValue}
                                </p>
                              ) : null}
                            </td>

                            <td className="px-3 py-4">
                              <p className="text-xl font-black">
                                {runner.progressPercent}%
                              </p>
                              <p className="mt-1 text-xs font-semibold text-slate-500">
                                {runner.passedCheckpoints} passed,{" "}
                                {runner.remainingCheckpoints} remaining
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
                                    CP {runner.latestCheckpoint.checkpointNo} -{" "}
                                    {runner.latestCheckpoint.checkpointName}
                                  </p>
                                  <p className="mt-1 text-xs font-semibold text-slate-500">
                                    {formatTime(runner.lastKnownPassageAt)}
                                  </p>
                                  <p className="mt-1 text-xs font-semibold text-slate-400">
                                    {relativeTime(runner.lastKnownPassageAt)}
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
                                  CP {runner.nextCheckpoint.checkpointNo} -{" "}
                                  {runner.nextCheckpoint.checkpointName}
                                </p>
                              ) : (
                                <p className="font-black text-emerald-700">
                                  Finished
                                </p>
                              )}
                            </td>

                            <td className="rounded-r-2xl px-3 py-4">
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
                          </tr>
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
