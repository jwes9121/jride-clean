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

type SoundPreviewPhase =
  | "fast"
  | "slow"
  | "winner"
  | "countdown";

type SoundPreviewState = {
  phase: SoundPreviewPhase;
  label: string;
  displayName: string;
  seconds: number | null;
};

const SOUND_PREVIEW_NAMES = [
  "RAFFLE SOUND TEST",
  "FAST ROULETTE",
  "SLOWING ROULETTE",
  "WINNER REVEAL",
];

function nextDelay(secondsUntilReveal: number | null | undefined) {
  const remaining = Number(secondsUntilReveal ?? 0);
  if (remaining > 20) return 60;
  if (remaining > 10) return 110;
  if (remaining > 5) return 180;
  if (remaining > 2) return 300;
  return 550;
}

function scheduleTone(
  context: AudioContext,
  options: {
    frequency: number;
    duration: number;
    volume: number;
    startOffset?: number;
    type?: OscillatorType;
  }
) {
  const startAt =
    context.currentTime + (options.startOffset || 0);
  const stopAt = startAt + options.duration;
  const peakAt = Math.min(
    stopAt - 0.002,
    startAt + 0.005
  );

  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = options.type || "square";
  oscillator.frequency.setValueAtTime(
    options.frequency,
    startAt
  );

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(
    Math.max(0.0002, options.volume),
    peakAt
  );
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    stopAt
  );

  oscillator.connect(gain);
  gain.connect(context.destination);

  oscillator.start(startAt);
  oscillator.stop(stopAt + 0.02);
}

export default function RaffleProjectorDisplayPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  const [state, setState] = React.useState<CurrentStateResponse | null>(null);
  const [names, setNames] = React.useState<AnimationName[]>([]);
  const [nameIndex, setNameIndex] = React.useState(0);
  const [loadedDrawId, setLoadedDrawId] = React.useState("");
  const [error, setError] = React.useState("");
  const [soundEnabled, setSoundEnabled] =
    React.useState(false);
  const [soundError, setSoundError] =
    React.useState("");
  const [soundPreview, setSoundPreview] =
    React.useState<SoundPreviewState | null>(null);

  const audioContextRef =
    React.useRef<AudioContext | null>(null);
  const secondsUntilRevealRef =
    React.useRef<number | null>(null);
  const previousPhaseRef =
    React.useRef<RafflePhase>("idle");
  const lastCountdownSecondRef =
    React.useRef<number | null>(null);
  const soundPreviewTimerRef =
    React.useRef<number | null>(null);
  const soundPreviewRunRef =
    React.useRef(0);

  const ensureAudioContext = React.useCallback(
    async () => {
      let context = audioContextRef.current;

      if (!context) {
        const AudioContextClass =
          window.AudioContext ||
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;

        if (!AudioContextClass) {
          throw new Error(
            "This browser does not support raffle audio."
          );
        }

        context = new AudioContextClass();
        audioContextRef.current = context;
      }

      if (context.state === "suspended") {
        await context.resume();
      }

      return context;
    },
    []
  );

  const enableSound = React.useCallback(async () => {
    try {
      const context = await ensureAudioContext();

      setSoundEnabled(true);
      setSoundError("");

      scheduleTone(context, {
        frequency: 660,
        duration: 0.07,
        volume: 0.055,
        type: "triangle",
      });

      scheduleTone(context, {
        frequency: 880,
        duration: 0.1,
        volume: 0.06,
        startOffset: 0.1,
        type: "triangle",
      });
    } catch (caught) {
      setSoundEnabled(false);
      setSoundError(
        caught instanceof Error
          ? caught.message
          : "Unable to enable raffle audio."
      );
    }
  }, [ensureAudioContext]);

  const disableSound = React.useCallback(() => {
    setSoundEnabled(false);
    setSoundError("");
  }, []);

  const playRouletteTick = React.useCallback(
    (
      secondsUntilReveal:
        | number
        | null
        | undefined
    ) => {
      if (!soundEnabled) return;

      const context = audioContextRef.current;

      if (!context || context.state !== "running") {
        return;
      }

      const remaining = Math.max(
        0,
        Number(secondsUntilReveal ?? 0)
      );
      const fastPhase = remaining > 20;

      const frequency =
        (
          fastPhase
            ? 820
            : 520 + remaining * 16
        ) +
        Math.random() * (
          fastPhase ? 260 : 120
        );

      scheduleTone(context, {
        frequency,
        duration: fastPhase ? 0.018 : 0.035,
        volume: fastPhase ? 0.024 : 0.04,
        type: "square",
      });

      scheduleTone(context, {
        frequency: frequency / 2,
        duration: fastPhase ? 0.024 : 0.045,
        volume: fastPhase ? 0.009 : 0.014,
        type: "triangle",
      });
    },
    [soundEnabled]
  );

  const playWinnerReveal = React.useCallback(() => {
    if (!soundEnabled) return;

    const context = audioContextRef.current;

    if (!context || context.state !== "running") {
      return;
    }

    [
      { frequency: 523.25, offset: 0 },
      { frequency: 659.25, offset: 0.12 },
      { frequency: 783.99, offset: 0.24 },
    ].forEach((note) => {
      scheduleTone(context, {
        frequency: note.frequency,
        duration: 0.22,
        volume: 0.065,
        startOffset: note.offset,
        type: "triangle",
      });
    });
  }, [soundEnabled]);

  const playCountdownTick = React.useCallback(
    (seconds: number) => {
      if (!soundEnabled || seconds <= 0) {
        return;
      }

      const context = audioContextRef.current;

      if (!context || context.state !== "running") {
        return;
      }

      const urgent = seconds <= 5;
      const frequency = urgent
        ? 980
        : seconds <= 10
        ? 760
        : 560;
      const startOffset = seconds === 20 ? 0.55 : 0;

      scheduleTone(context, {
        frequency,
        duration: urgent ? 0.1 : 0.07,
        volume: urgent ? 0.07 : 0.045,
        startOffset,
        type: "sine",
      });

      if (urgent) {
        scheduleTone(context, {
          frequency: frequency * 1.18,
          duration: 0.08,
          volume: 0.045,
          startOffset: startOffset + 0.13,
          type: "sine",
        });
      }
    },
    [soundEnabled]
  );

  const stopSoundPreview = React.useCallback(() => {
    soundPreviewRunRef.current += 1;

    if (soundPreviewTimerRef.current !== null) {
      window.clearTimeout(soundPreviewTimerRef.current);
      soundPreviewTimerRef.current = null;
    }

    setSoundPreview(null);
  }, []);

  const startSoundPreview = React.useCallback(async () => {
    if (!soundEnabled) {
      setSoundError(
        "Enable Raffle Sound first, then run the local sound preview."
      );
      return;
    }

    try {
      await ensureAudioContext();
    } catch (caught) {
      setSoundError(
        caught instanceof Error
          ? caught.message
          : "Unable to start raffle sound preview."
      );
      return;
    }

    stopSoundPreview();
    setSoundError("");

    const runId = soundPreviewRunRef.current;
    let fastTick = 0;

    const schedule = (
      callback: () => void,
      delayMs: number
    ) => {
      soundPreviewTimerRef.current =
        window.setTimeout(() => {
          if (
            soundPreviewRunRef.current !== runId
          ) {
            return;
          }

          callback();
        }, delayMs);
    };

    const countdownValues = [
      20,
      10,
      5,
      4,
      3,
      2,
      1,
    ];

    const runCountdown = (index: number) => {
      if (
        soundPreviewRunRef.current !== runId
      ) {
        return;
      }

      if (index >= countdownValues.length) {
        schedule(() => {
          setSoundPreview(null);
          soundPreviewTimerRef.current = null;
        }, 700);
        return;
      }

      const seconds = countdownValues[index];

      setSoundPreview({
        phase: "countdown",
        label: "Claim Countdown Sound",
        displayName: "NO WINNER - LOCAL SOUND TEST",
        seconds,
      });

      playCountdownTick(seconds);

      schedule(
        () => runCountdown(index + 1),
        1000
      );
    };

    const revealWinner = () => {
      setSoundPreview({
        phase: "winner",
        label: "Winner Reveal Chime",
        displayName: "SOUND TEST COMPLETE",
        seconds: null,
      });

      playWinnerReveal();

      schedule(() => runCountdown(0), 900);
    };

    const slowRemaining = [
      20,
      18,
      16,
      14,
      12,
      10,
      8,
      6,
      4,
      2,
      1,
    ];

    const slowDelays = [
      120,
      140,
      160,
      190,
      220,
      260,
      310,
      360,
      420,
      500,
      600,
    ];

    const runSlow = (index: number) => {
      if (
        soundPreviewRunRef.current !== runId
      ) {
        return;
      }

      if (index >= slowRemaining.length) {
        revealWinner();
        return;
      }

      const remaining = slowRemaining[index];

      setSoundPreview({
        phase: "slow",
        label: "Slowing Roulette Sound",
        displayName:
          SOUND_PREVIEW_NAMES[
            (index + 1) %
              SOUND_PREVIEW_NAMES.length
          ],
        seconds: remaining,
      });

      playRouletteTick(remaining);

      schedule(
        () => runSlow(index + 1),
        slowDelays[index]
      );
    };

    const runFast = () => {
      if (
        soundPreviewRunRef.current !== runId
      ) {
        return;
      }

      if (fastTick >= 80) {
        runSlow(0);
        return;
      }

      const remaining =
        60 -
        Math.min(
          39,
          Math.floor((fastTick / 80) * 40)
        );

      setSoundPreview({
        phase: "fast",
        label: "Fast Roulette Sound",
        displayName:
          SOUND_PREVIEW_NAMES[
            fastTick %
              SOUND_PREVIEW_NAMES.length
          ],
        seconds: remaining,
      });

      playRouletteTick(remaining);
      fastTick += 1;

      schedule(runFast, 100);
    };

    runFast();
  }, [
    ensureAudioContext,
    playCountdownTick,
    playRouletteTick,
    playWinnerReveal,
    soundEnabled,
    stopSoundPreview,
  ]);

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
    secondsUntilRevealRef.current =
      state?.secondsUntilReveal ?? null;
  }, [state?.secondsUntilReveal]);

  React.useEffect(() => {
    if (
      state?.phase !== "rolling" ||
      names.length === 0
    ) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const tick = () => {
      if (cancelled) return;

      const remaining =
        secondsUntilRevealRef.current;

      setNameIndex(
        (current) =>
          (current + 1) % names.length
      );

      playRouletteTick(remaining);

      timer = window.setTimeout(
        tick,
        nextDelay(remaining)
      );
    };

    tick();

    return () => {
      cancelled = true;

      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [
    names,
    playRouletteTick,
    state?.phase,
  ]);

  React.useEffect(() => {
    if (
      state?.phase &&
      state.phase !== "idle"
    ) {
      stopSoundPreview();
    }
  }, [state?.phase, stopSoundPreview]);

  React.useEffect(() => {
    const currentPhase =
      state?.phase || "idle";
    const previousPhase =
      previousPhaseRef.current;

    if (
      previousPhase === "rolling" &&
      currentPhase === "claim"
    ) {
      playWinnerReveal();
    }

    if (currentPhase !== "claim") {
      lastCountdownSecondRef.current = null;
    }

    previousPhaseRef.current = currentPhase;
  }, [playWinnerReveal, state?.phase]);

  React.useEffect(() => {
    if (state?.phase !== "claim") {
      lastCountdownSecondRef.current = null;
      return;
    }

    const rawSeconds = Number(
      state?.secondsUntilClaimDeadline ?? 0
    );

    if (!Number.isFinite(rawSeconds)) {
      return;
    }

    const seconds = Math.max(
      0,
      Math.ceil(rawSeconds)
    );

    if (
      lastCountdownSecondRef.current ===
      seconds
    ) {
      return;
    }

    lastCountdownSecondRef.current = seconds;
    playCountdownTick(seconds);
  }, [
    playCountdownTick,
    state?.phase,
    state?.secondsUntilClaimDeadline,
  ]);

  React.useEffect(() => {
    return () => {
      soundPreviewRunRef.current += 1;

      if (
        soundPreviewTimerRef.current !== null
      ) {
        window.clearTimeout(
          soundPreviewTimerRef.current
        );
        soundPreviewTimerRef.current = null;
      }

      const context = audioContextRef.current;

      audioContextRef.current = null;

      if (
        context &&
        context.state !== "closed"
      ) {
        void context.close().catch(() => undefined);
      }
    };
  }, []);

  const phase = state?.phase || "idle";
  const activeDraw = state?.activeDraw || null;
  const winner = activeDraw?.winner?.attendee || null;
  const currentName = names[nameIndex] || null;
  const blurredNames = names.slice(nameIndex + 1, nameIndex + 7);
  const winnerStatus = activeDraw?.winner?.status || "";

  return (
    <main className="min-h-screen overflow-hidden bg-black px-6 pb-36 pt-8 text-white md:pb-40">
      <div className="fixed right-4 top-4 z-[70] flex max-w-[260px] flex-col items-end gap-2">
        <button
          type="button"
          aria-pressed={soundEnabled}
          onClick={() => {
            if (soundEnabled) {
              disableSound();
            } else {
              void enableSound();
            }
          }}
          className={`rounded-xl px-4 py-3 text-sm font-black shadow-2xl ${
            soundEnabled
              ? "bg-emerald-500 text-slate-950"
              : "bg-amber-300 text-slate-950"
          }`}
        >
          {soundEnabled
            ? "Raffle Sound ON"
            : "Enable Raffle Sound"}
        </button>

        {soundEnabled && phase === "idle" ? (
          <button
            type="button"
            onClick={() => {
              if (soundPreview) {
                stopSoundPreview();
              } else {
                void startSoundPreview();
              }
            }}
            className={`rounded-xl px-4 py-3 text-sm font-black shadow-2xl ${
              soundPreview
                ? "bg-red-600 text-white"
                : "bg-cyan-400 text-slate-950"
            }`}
          >
            {soundPreview
              ? "Stop Local Sound Preview"
              : "Preview Raffle Sounds - No Draw"}
          </button>
        ) : null}

        {!soundEnabled ? (
          <p className="rounded-lg bg-slate-950/90 px-3 py-2 text-right text-xs font-bold text-slate-300">
            Click once on this projector before the draw. Browsers block automatic sound until the operator enables it.
          </p>
        ) : null}

        {soundEnabled && phase === "idle" ? (
          <p className="rounded-lg bg-slate-950/90 px-3 py-2 text-right text-xs font-bold text-slate-300">
            Local preview uses dummy text only. It does not call the raffle API, select a winner, create a draw, or change the database.
          </p>
        ) : null}

        {soundError ? (
          <p className="rounded-lg bg-red-700 px-3 py-2 text-right text-xs font-black text-white">
            {soundError}
          </p>
        ) : null}
      </div>

      {soundPreview ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/95 p-6 text-white">
          <div className="w-full max-w-5xl rounded-[2rem] border-4 border-cyan-300 bg-slate-950 p-10 text-center shadow-2xl">
            <p className="text-lg font-black uppercase tracking-[0.3em] text-cyan-300">
              Local Sound Preview - No Raffle Draw
            </p>
            <h2 className="mt-5 text-4xl font-black md:text-6xl">
              {soundPreview.label}
            </h2>
            <div className="mt-8 rounded-[2rem] bg-white px-8 py-12 text-slate-950">
              <p className="text-5xl font-black md:text-8xl">
                {soundPreview.displayName}
              </p>
              {soundPreview.seconds !== null ? (
                <p className="mt-6 text-7xl font-black text-amber-600 md:text-9xl">
                  {soundPreview.seconds}
                </p>
              ) : null}
            </div>
            <p className="mt-6 text-lg font-bold text-slate-300">
              This preview is local to this projector. No attendee, winner, raffle draw, or database record is used.
            </p>
            <button
              type="button"
              onClick={stopSoundPreview}
              className="mt-6 rounded-xl bg-red-600 px-6 py-4 text-lg font-black text-white"
            >
              Stop Preview
            </button>
          </div>
        </div>
      ) : null}

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
