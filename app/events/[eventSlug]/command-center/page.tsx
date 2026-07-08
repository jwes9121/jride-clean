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

function scannerBadgeClass(status: string | undefined) {
  if (status === "online") return "border-emerald-300 bg-emerald-100 text-emerald-800";
  if (status === "idle") return "border-amber-300 bg-amber-100 text-amber-900";
  return "border-slate-300 bg-slate-100 text-slate-700";
}

function scannerLabel(status: string | undefined) {
  if (status === "online") return "ONLINE";
  if (status === "idle") return "IDLE";
  return "UNKNOWN";
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
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
      setError(err instanceof Error ? err.message : "Dashboard failed to load.");
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
  const topBatches = data?.topBatches || [];
  const recentActivity = data?.recentActivity || [];
  const scanner = data?.scanner;

  const checkInPct = percent(summary.checkedIn, summary.registeredAlumni + summary.guests);
  const maxBatchCount = Math.max(1, ...topBatches.map((item) => item.count));

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
                One-gate live operations view for {eventSlug}.
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
                      <p className="text-sm font-black text-slate-500">Last 1 minute</p>
                      <p className="mt-1 text-4xl font-black">
                        {formatNumber(velocity.last1Min)}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-slate-100 p-4">
                      <p className="text-sm font-black text-slate-500">Last 5 minutes</p>
                      <p className="mt-1 text-4xl font-black">
                        {formatNumber(velocity.last5Min)}
                      </p>
                      <p className="mt-1 text-sm font-bold text-slate-500">
                        {ratePerMinute(velocity.last5Min, 5)} per minute
                      </p>
                    </div>

                    <div className="rounded-2xl bg-slate-100 p-4">
                      <p className="text-sm font-black text-slate-500">Last 15 minutes</p>
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
                    <p className="text-sm font-black text-slate-500">Last Scan</p>
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
                            <p className="font-mono font-black">{item.count}</p>
                          </div>
                          <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-amber-400"
                              style={{
                                width: `${Math.max(8, Math.round((item.count / maxBatchCount) * 100))}%`,
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
                    <h2 className="mt-2 text-3xl font-black">Recent Check-ins</h2>
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
                            <p className="text-xl font-black">{item.fullName}</p>
                          </div>
                          <p className="mt-1 text-sm font-semibold text-slate-500">
                            {event?.groupLabel || "Batch"} {item.groupValue || "-"}
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
