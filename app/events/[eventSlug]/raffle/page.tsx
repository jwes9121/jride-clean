"use client";

import * as React from "react";
import { useParams } from "next/navigation";

type RafflePhase = "idle" | "rolling" | "claim" | "expired";

type RaffleAttendee = {
  attendeeId: string;
  fullName: string;
  groupValue: string | null;
  registrationNumber: string;
};

type CurrentStateResponse = {
  success: boolean;
  phase?: RafflePhase;
  secondsUntilReveal?: number | null;
  secondsUntilClaimDeadline?: number | null;
  event?: { title: string; slug: string; groupLabel: string };
  eligibleCount?: number;
  activeDraw?: {
    drawId: string;
    drawName: string;
    drawType: string;
    status: string;
    revealAt: string | null;
    completedAt: string | null;
    winner: {
      winnerId: string;
      status: string;
      claimDeadlineAt: string | null;
      claimedAt: string | null;
      attendee: RaffleAttendee | null;
    } | null;
  } | null;
  history?: Array<{
    winnerId: string;
    drawId: string;
    status: string;
    claimDeadlineAt: string | null;
    claimedAt: string | null;
    attendee: RaffleAttendee | null;
  }>;
  error?: string;
};

type DrawResponse = {
  success: boolean;
  error?: string;
};

type WinnerActionResponse = {
  success: boolean;
  error?: string;
};

const DRAW_TYPES = [
  { value: "hourly", label: "Hourly" },
  { value: "minor", label: "Minor Prize" },
  { value: "major", label: "Major Prize" },
  { value: "grand", label: "Grand Prize" },
];

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

function statusLabel(value: string | null | undefined) {
  return String(value || "unknown").replace(/_/g, " ");
}

function phaseLabel(phase: RafflePhase) {
  if (phase === "rolling") return "Rolling";
  if (phase === "claim") return "Claim Countdown";
  if (phase === "expired") return "Awaiting Decision";
  return "Idle";
}

export default function EventRaffleConsolePage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  const [state, setState] = React.useState<CurrentStateResponse | null>(null);
  const [drawName, setDrawName] = React.useState("Raffle Draw");
  const [drawType, setDrawType] = React.useState("minor");
  const [rollSeconds, setRollSeconds] = React.useState(60);
  const [claimSeconds, setClaimSeconds] = React.useState(20);
  const [loading, setLoading] = React.useState(true);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");

  const loadCurrent = React.useCallback(async () => {
    if (!eventSlug) return;
    try {
      const res = await fetch(`/api/events/${eventSlug}/raffle/current`, {
        cache: "no-store",
      });
      const data = (await res.json()) as CurrentStateResponse;
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to load raffle state.");
      }
      setState(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load raffle state.");
    } finally {
      setLoading(false);
    }
  }, [eventSlug]);

  React.useEffect(() => {
    void loadCurrent();
    const timer = window.setInterval(() => void loadCurrent(), 2000);
    return () => window.clearInterval(timer);
  }, [loadCurrent]);

  async function startDraw() {
    setActionLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/events/${eventSlug}/raffle/draw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drawName: drawName.trim() || "Raffle Draw",
          drawType,
          rollSeconds,
          claimSeconds,
        }),
      });
      const data = (await res.json()) as DrawResponse;
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to start draw.");
      }
      setNotice("Raffle draw started.");
      await loadCurrent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start draw.");
    } finally {
      setActionLoading(false);
    }
  }

  async function updateWinner(action: "claim" | "unclaimed") {
    const winnerId = state?.activeDraw?.winner?.winnerId;
    if (!winnerId) return;

    setActionLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(
        `/api/events/${eventSlug}/raffle/${encodeURIComponent(winnerId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }
      );
      const data = (await res.json()) as WinnerActionResponse;
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to update winner.");
      }
      setNotice(action === "claim" ? "Winner marked claimed." : "Winner marked unclaimed.");
      await loadCurrent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update winner.");
    } finally {
      setActionLoading(false);
    }
  }

  const phase = state?.phase || "idle";
  const activeDraw = state?.activeDraw || null;
  const winner = activeDraw?.winner || null;
  const attendee = winner?.attendee || null;
  const canResolve =
    !!winner &&
    winner.status === "selected" &&
    (phase === "claim" || phase === "expired") &&
    !actionLoading;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <section className="mx-auto max-w-6xl">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
            JRide Events
          </p>
          <h1 className="mt-3 text-4xl font-black">
            {state?.event?.title || "Raffle MC Console"}
          </h1>
          <p className="mt-2 text-slate-300">
            Phase: {phaseLabel(phase)} | Eligible: {state?.eligibleCount || 0}
          </p>

          {loading ? <p className="mt-6">Loading raffle state...</p> : null}
          {notice ? (
            <p className="mt-5 rounded-2xl bg-emerald-100 p-4 font-bold text-emerald-800">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="mt-5 rounded-2xl bg-red-100 p-4 font-bold text-red-800">
              {error}
            </p>
          ) : null}

          {!loading && !activeDraw ? (
            <div className="mt-6 rounded-3xl bg-white p-6 text-slate-950">
              <h2 className="text-3xl font-black">New Draw</h2>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label>
                  <span className="font-bold">Draw Name</span>
                  <input
                    value={drawName}
                    onChange={(event) => setDrawName(event.target.value)}
                    className="mt-2 w-full rounded-2xl border p-4"
                  />
                </label>

                <label>
                  <span className="font-bold">Draw Type</span>
                  <select
                    value={drawType}
                    onChange={(event) => setDrawType(event.target.value)}
                    className="mt-2 w-full rounded-2xl border p-4"
                  >
                    {DRAW_TYPES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="font-bold">Rolling Seconds</span>
                  <input
                    type="number"
                    min={10}
                    max={180}
                    value={rollSeconds}
                    onChange={(event) => setRollSeconds(Number(event.target.value))}
                    className="mt-2 w-full rounded-2xl border p-4"
                  />
                </label>

                <label>
                  <span className="font-bold">Claim Seconds</span>
                  <input
                    type="number"
                    min={10}
                    max={120}
                    value={claimSeconds}
                    onChange={(event) => setClaimSeconds(Number(event.target.value))}
                    className="mt-2 w-full rounded-2xl border p-4"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={startDraw}
                disabled={actionLoading || (state?.eligibleCount || 0) < 1}
                className="mt-6 w-full rounded-2xl bg-amber-400 px-6 py-5 text-xl font-black disabled:opacity-50"
              >
                {actionLoading ? "Starting..." : "Start Draw"}
              </button>
            </div>
          ) : null}

          {!loading && activeDraw ? (
            <div className="mt-6 rounded-3xl bg-white p-6 text-slate-950">
              <h2 className="text-3xl font-black">{activeDraw.drawName}</h2>
              <p className="mt-2 font-semibold text-slate-500">
                {statusLabel(activeDraw.drawType)} | {phaseLabel(phase)}
              </p>

              <div className="mt-6 rounded-3xl bg-slate-950 p-8 text-center text-white">
                <p className="text-sm font-black uppercase tracking-[0.2em] text-slate-400">
                  Winner
                </p>
                <p className="mt-4 text-5xl font-black">
                  {phase === "rolling" ? "Hidden until reveal" : attendee?.fullName || "No winner"}
                </p>
                {phase !== "rolling" && attendee ? (
                  <p className="mt-3 text-xl font-bold text-amber-300">
                    {state?.event?.groupLabel || "Batch"} {attendee.groupValue || "-"}
                  </p>
                ) : null}
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-slate-100 p-4">
                  <p className="font-bold text-slate-500">Seconds to reveal</p>
                  <p className="mt-2 text-4xl font-black">
                    {state?.secondsUntilReveal ?? 0}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-100 p-4">
                  <p className="font-bold text-slate-500">Claim countdown</p>
                  <p className="mt-2 text-4xl font-black">
                    {state?.secondsUntilClaimDeadline ?? 0}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => updateWinner("claim")}
                  disabled={!canResolve}
                  className="rounded-2xl bg-emerald-600 p-5 text-lg font-black text-white disabled:opacity-50"
                >
                  Mark Claimed
                </button>
                <button
                  type="button"
                  onClick={() => updateWinner("unclaimed")}
                  disabled={!canResolve}
                  className="rounded-2xl bg-red-700 p-5 text-lg font-black text-white disabled:opacity-50"
                >
                  Mark Unclaimed
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-6 rounded-3xl bg-white p-6 text-slate-950">
            <h2 className="text-3xl font-black">Recent Winners</h2>
            <div className="mt-4 grid gap-3">
              {(state?.history || []).length ? (
                (state?.history || []).map((item) => (
                  <div
                    key={item.winnerId}
                    className="rounded-2xl bg-slate-100 p-4"
                  >
                    <p className="text-lg font-black">
                      {item.attendee?.fullName || "Unknown attendee"}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-500">
                      {statusLabel(item.status)} |{" "}
                      {item.attendee?.registrationNumber || "-"} |{" "}
                      {formatTime(item.claimedAt || item.claimDeadlineAt)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="font-semibold text-slate-500">No raffle winners yet.</p>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
