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
  error?: string;
};

type AnimationName = {
  attendeeId: string;
  fullName: string;
  groupValue: string | null;
};

type AnimationNamesResponse = {
  success: boolean;
  names?: AnimationName[];
  error?: string;
};

function nextDelay(secondsUntilReveal: number | null | undefined) {
  const remaining = Number(secondsUntilReveal ?? 0);
  if (remaining > 20) return 60;
  if (remaining > 10) return 110;
  if (remaining > 5) return 180;
  if (remaining > 2) return 300;
  return 550;
}

export default function RaffleProjectorDisplayPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  const [state, setState] = React.useState<CurrentStateResponse | null>(null);
  const [names, setNames] = React.useState<AnimationName[]>([]);
  const [nameIndex, setNameIndex] = React.useState(0);
  const [loadedDrawId, setLoadedDrawId] = React.useState("");
  const [error, setError] = React.useState("");

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
    }
  }, [eventSlug]);

  React.useEffect(() => {
    void loadCurrent();
    const timer = window.setInterval(() => void loadCurrent(), 1000);
    return () => window.clearInterval(timer);
  }, [loadCurrent]);

  React.useEffect(() => {
    const drawId = state?.activeDraw?.drawId || "";
    if (!drawId || drawId === loadedDrawId) return;

    let active = true;

    async function loadNames() {
      try {
        const res = await fetch(
          `/api/events/${eventSlug}/raffle/animation-names`,
          { cache: "no-store" }
        );
        const data = (await res.json()) as AnimationNamesResponse;

        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to load animation names.");
        }

        if (!active) return;
        setNames(data.names || []);
        setNameIndex(0);
        setLoadedDrawId(drawId);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Failed to load animation names."
        );
      }
    }

    void loadNames();
    return () => {
      active = false;
    };
  }, [eventSlug, loadedDrawId, state?.activeDraw?.drawId]);

  React.useEffect(() => {
    if (state?.phase !== "rolling" || names.length === 0) return;

    let cancelled = false;
    let timer: number | null = null;

    const tick = () => {
      if (cancelled) return;
      setNameIndex((current) => (current + 1) % names.length);
      timer = window.setTimeout(tick, nextDelay(state.secondsUntilReveal));
    };

    tick();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [names, state?.phase, state?.secondsUntilReveal]);

  const phase = state?.phase || "idle";
  const activeDraw = state?.activeDraw || null;
  const winner = activeDraw?.winner?.attendee || null;
  const currentName = names[nameIndex] || null;
  const blurredNames = names.slice(nameIndex + 1, nameIndex + 7);
  const winnerStatus = activeDraw?.winner?.status || "";

  return (
    <main className="min-h-screen overflow-hidden bg-black px-6 pb-36 pt-8 text-white md:pb-40">
      <section className="mx-auto flex min-h-[calc(100vh-12rem)] max-w-7xl flex-col">
        <header className="text-center">
          <p className="text-xl font-black uppercase tracking-[0.4em] text-amber-300">
            JRide Events
          </p>
          <p className="mt-2 text-sm font-black uppercase tracking-[0.22em] text-slate-400 md:text-base">
            Powered by JRide Corporation
          </p>
          <h1 className="mt-4 text-5xl font-black md:text-7xl">
            {state?.event?.title || "Digital Raffle"}
          </h1>
          <p className="mt-3 text-2xl font-bold text-slate-300">
            {activeDraw?.drawName || "Waiting for next draw"}
          </p>
        </header>

        {error ? (
          <div className="mx-auto mt-8 w-full max-w-4xl rounded-3xl bg-red-700 p-6 text-center text-2xl font-black">
            {error}
          </div>
        ) : null}

        <div className="mt-8 flex flex-1 flex-col justify-center">
          {phase === "idle" ? (
            <div className="mx-auto w-full max-w-5xl rounded-[2rem] border border-slate-700 bg-slate-950 p-12 text-center shadow-2xl">
              <p className="text-5xl font-black text-slate-300 md:text-7xl">
                Waiting for the next draw
              </p>
            </div>
          ) : null}

          {phase === "rolling" ? (
            <>
              <div className="mx-auto w-full max-w-5xl rounded-[2rem] border-4 border-amber-300 bg-white px-8 py-14 text-center text-slate-950 shadow-2xl">
                <p className="text-5xl font-black leading-tight md:text-8xl">
                  {currentName?.fullName || "Rolling..."}
                </p>
                <p className="mt-5 text-3xl font-black text-amber-700">
                  {state?.event?.groupLabel || "Batch"}{" "}
                  {currentName?.groupValue || "-"}
                </p>
              </div>

              <div className="mx-auto mt-8 w-full max-w-6xl space-y-3 blur-[2px] opacity-45">
                {blurredNames.map((item, index) => (
                  <div
                    key={`${item.attendeeId}-${index}`}
                    className="rounded-2xl bg-slate-900 px-8 py-4 text-center"
                  >
                    <p className="text-3xl font-black">{item.fullName}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8 text-center">
                <p className="text-8xl font-black text-amber-300 md:text-9xl">
                  {state?.secondsUntilReveal ?? 0}
                </p>
                <p className="mt-2 text-2xl font-black uppercase tracking-[0.25em] text-slate-400">
                  seconds to reveal
                </p>
              </div>
            </>
          ) : null}

          {(phase === "claim" || phase === "expired") && winner ? (
            <>
              <div className="mx-auto w-full max-w-5xl rounded-[2rem] border-4 border-emerald-300 bg-white px-8 py-14 text-center text-slate-950 shadow-2xl">
                <p className="text-2xl font-black uppercase tracking-[0.3em] text-emerald-700">
                  Winner
                </p>
                <p className="mt-6 text-6xl font-black leading-tight md:text-9xl">
                  {winner.fullName}
                </p>
                <p className="mt-6 text-4xl font-black text-amber-700">
                  {state?.event?.groupLabel || "Batch"}{" "}
                  {winner.groupValue || "-"}
                </p>
              </div>

              {phase === "claim" ? (
                <div className="mt-8 text-center">
                  <p className="text-9xl font-black text-amber-300">
                    {state?.secondsUntilClaimDeadline ?? 0}
                  </p>
                  <p className="mt-3 text-3xl font-black uppercase tracking-[0.2em] text-slate-300">
                    Come forward to claim your prize
                  </p>
                </div>
              ) : null}

              {phase === "expired" ? (
                <div className="mx-auto mt-8 w-full max-w-4xl rounded-3xl bg-red-700 p-8 text-center">
                  <p className="text-5xl font-black">Claim time expired</p>
                  <p className="mt-3 text-2xl font-bold">
                    Awaiting MC decision
                  </p>
                </div>
              ) : null}
            </>
          ) : null}

          {winnerStatus === "claimed" ? (
            <div className="mx-auto mt-8 w-full max-w-4xl rounded-3xl bg-emerald-600 p-8 text-center">
              <p className="text-6xl font-black">CLAIMED</p>
            </div>
          ) : null}

          {winnerStatus === "unclaimed" ? (
            <div className="mx-auto mt-8 w-full max-w-4xl rounded-3xl bg-red-700 p-8 text-center">
              <p className="text-6xl font-black">UNCLAIMED</p>
              <p className="mt-3 text-2xl font-bold">Prepare for redraw</p>
            </div>
          ) : null}
        </div>
      </section>

      <footer className="fixed inset-x-0 bottom-0 z-50 border-t border-amber-300/40 bg-slate-950/95 px-4 py-4 text-center shadow-[0_-12px_30px_rgba(0,0,0,0.55)] backdrop-blur md:py-5">
        <p className="text-sm font-black uppercase tracking-[0.25em] text-slate-400 md:text-base">
          Sponsored by Batch 2001
        </p>
        <p className="mt-1 text-2xl font-black tracking-[0.08em] text-amber-300 md:text-4xl">
          Dos Mil Uno
        </p>
      </footer>
    </main>
  );
}
