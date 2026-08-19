"use client";

import * as React from "react";
import { useParams } from "next/navigation";

type DisplayResponse = {
  success: boolean;
  reason?: string;
  message?: string;
  generatedAt?: string;
  event?: {
    id: string;
    slug: string;
    name: string;
    shortName: string | null;
    eventDate: string | null;
    venue: string | null;
    status: string;
  };
  station?: {
    id: string;
    name: string;
  };
  labels?: {
    primary: string;
    start: string;
    finish: string;
  };
  counts?: {
    registeredPeople: number;
    presentPeople: number;
    awaitingArrival: number;
    registeredParticipants: number;
    presentParticipants: number;
    started: number;
    onCourse: number;
    finished: number;
    notStarted: number;
  };
  rates?: {
    attendancePercent: number;
    finishPercent: number;
  };
  latest?: {
    checkinAt: string | null;
    finishAt: string | null;
  };
};

const TOKEN_PREFIX = "jrst_";

function tokenKey(eventSlug: string) {
  return `jride_event_attendance_display_token_${eventSlug}`;
}

function validToken(value: string) {
  return (
    value.startsWith(TOKEN_PREFIX) &&
    value.length > TOKEN_PREFIX.length
  );
}

function formatTime(value: string | null | undefined) {
  if (!value) return "None yet";

  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function Metric({
  label,
  value,
  helper,
  emphasis,
}: {
  label: string;
  value: number | string;
  helper?: string;
  emphasis?:
    | "cyan"
    | "emerald"
    | "amber"
    | "violet"
    | "slate";
}) {
  const className =
    emphasis === "emerald"
      ? "border-emerald-400 bg-emerald-950/40"
      : emphasis === "amber"
      ? "border-amber-400 bg-amber-950/40"
      : emphasis === "violet"
      ? "border-violet-400 bg-violet-950/40"
      : emphasis === "cyan"
      ? "border-cyan-400 bg-cyan-950/40"
      : "border-slate-700 bg-slate-900";

  return (
    <div className={`rounded-3xl border p-6 ${className}`}>
      <p className="text-sm font-black uppercase tracking-[0.18em] text-slate-300">
        {label}
      </p>
      <p className="mt-3 text-6xl font-black sm:text-7xl">
        {value}
      </p>
      {helper ? (
        <p className="mt-3 text-sm font-bold text-slate-400">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

export default function AttendanceDisplayPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  const [tokenLoaded, setTokenLoaded] =
    React.useState(false);
  const [stationToken, setStationToken] =
    React.useState("");
  const [setupInput, setSetupInput] =
    React.useState("");
  const [data, setData] =
    React.useState<DisplayResponse | null>(null);
  const [error, setError] = React.useState("");
  const [clock, setClock] = React.useState(
    new Date()
  );

  React.useEffect(() => {
    let stored = "";

    try {
      stored =
        window.localStorage.getItem(
          tokenKey(eventSlug)
        ) || "";
    } catch {}

    if (validToken(stored)) {
      setStationToken(stored);
    }

    setTokenLoaded(true);
  }, [eventSlug]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    if (!stationToken) return;

    let cancelled = false;
    let timer: number | null = null;

    async function load() {
      try {
        const response = await fetch(
          `/api/events/${encodeURIComponent(
            eventSlug
          )}/attendance-display`,
          {
            cache: "no-store",
            headers: {
              "X-Event-Station-Token":
                stationToken,
            },
          }
        );

        const payload =
          (await response.json()) as DisplayResponse;

        if (
          response.status === 401 ||
          payload.reason ===
            "station_auth_required"
        ) {
          try {
            window.localStorage.removeItem(
              tokenKey(eventSlug)
            );
          } catch {}

          setStationToken("");
          setData(null);
          setError(
            payload.message ||
              "Attendance display token is invalid, expired, or revoked."
          );
          return;
        }

        if (!response.ok || !payload.success) {
          throw new Error(
            payload.message ||
              "Attendance display failed."
          );
        }

        if (!cancelled) {
          setData(payload);
          setError("");
        }
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Attendance display failed."
          );
        }
      } finally {
        if (!cancelled && stationToken) {
          timer = window.setTimeout(
            load,
            2000
          );
        }
      }
    }

    void load();

    return () => {
      cancelled = true;

      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [eventSlug, stationToken]);

  function saveToken() {
    const value = setupInput.trim();

    if (!validToken(value)) {
      setError(
        'Attendance display token must begin with "jrst_".'
      );
      return;
    }

    try {
      window.localStorage.setItem(
        tokenKey(eventSlug),
        value
      );
    } catch {
      setError(
        "Could not save the display token on this device."
      );
      return;
    }

    setError("");
    setSetupInput("");
    setStationToken(value);
  }

  function resetToken() {
    try {
      window.localStorage.removeItem(
        tokenKey(eventSlug)
      );
    } catch {}

    setStationToken("");
    setData(null);
  }

  async function enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
    } catch {}
  }

  if (!tokenLoaded) {
    return (
      <main className="min-h-screen bg-black p-8 text-white">
        Loading attendance display...
      </main>
    );
  }

  if (!stationToken) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-10 text-white">
        <section className="mx-auto max-w-xl rounded-3xl border border-violet-500/50 bg-slate-900 p-7 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">
            JRide Events Display
          </p>
          <h1 className="mt-3 text-3xl font-black">
            Attendance Wallboard Setup
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Enter the event-scoped Projector token issued for this monitor. A public link alone does not authorize the display.
          </p>

          <input
            type="password"
            value={setupInput}
            onChange={(event) =>
              setSetupInput(event.target.value)
            }
            placeholder="jrst_..."
            autoComplete="off"
            className="mt-5 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 font-mono outline-none focus:border-violet-300"
          />

          <button
            type="button"
            onClick={saveToken}
            className="mt-4 w-full rounded-2xl bg-violet-400 px-5 py-4 font-black text-slate-950"
          >
            Save Display Token
          </button>

          {error ? (
            <p className="mt-4 rounded-2xl bg-red-100 p-4 text-sm font-bold text-red-800">
              {error}
            </p>
          ) : null}
        </section>
      </main>
    );
  }

  const counts = data?.counts || {
    registeredPeople: 0,
    presentPeople: 0,
    awaitingArrival: 0,
    registeredParticipants: 0,
    presentParticipants: 0,
    started: 0,
    onCourse: 0,
    finished: 0,
    notStarted: 0,
  };
  const rates = data?.rates || {
    attendancePercent: 0,
    finishPercent: 0,
  };
  const labels = data?.labels || {
    primary: "Participants",
    start: "Start",
    finish: "Finish",
  };

  return (
    <main className="min-h-screen bg-black p-4 text-white sm:p-6">
      <header className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-300">
              JRide Events - Live Attendance
            </p>
            <h1 className="mt-2 text-3xl font-black sm:text-5xl">
              {data?.event?.name ||
                "Event Attendance"}
            </h1>
            <p className="mt-2 text-sm font-bold text-slate-400">
              {data?.event?.venue || ""}
              {data?.event?.venue ? " | " : ""}
              Status: {data?.event?.status || "-"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-2xl bg-slate-900 px-5 py-3 text-right">
              <p className="font-mono text-2xl font-black">
                {new Intl.DateTimeFormat(
                  "en-PH",
                  {
                    timeZone:
                      "Asia/Manila",
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: true,
                  }
                ).format(clock)}
              </p>
              <p className="mt-1 text-xs font-bold text-slate-500">
                Auto refresh every 2 seconds
              </p>
            </div>
            <button
              type="button"
              onClick={() => void enterFullscreen()}
              className="rounded-xl bg-violet-400 px-4 py-3 text-sm font-black text-slate-950"
            >
              Full Screen
            </button>
            <button
              type="button"
              onClick={resetToken}
              className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-black text-slate-300"
            >
              Reset Display
            </button>
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-2xl bg-red-950 p-4 font-bold text-red-200">
            {error}
          </p>
        ) : null}
      </header>

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <Metric
          label="Present / Checked In"
          value={counts.presentPeople}
          helper={`${counts.registeredPeople} registered people`}
          emphasis="emerald"
        />
        <Metric
          label="Awaiting Arrival"
          value={counts.awaitingArrival}
          helper={`${rates.attendancePercent}% attendance`}
          emphasis="amber"
        />
        <Metric
          label={labels.primary}
          value={`${counts.presentParticipants}/${counts.registeredParticipants}`}
          helper="present / registered primary participants"
          emphasis="cyan"
        />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <Metric
          label={labels.start}
          value={counts.started}
          helper={`${counts.notStarted} present but not started`}
          emphasis="cyan"
        />
        <Metric
          label="On Course"
          value={counts.onCourse}
          helper="started but not yet finished"
          emphasis="violet"
        />
        <Metric
          label={labels.finish}
          value={counts.finished}
          helper={`${rates.finishPercent}% of starters finished`}
          emphasis="emerald"
        />
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
            Latest Attendance
          </p>
          <p className="mt-3 text-3xl font-black">
            {formatTime(data?.latest?.checkinAt)}
          </p>
          <p className="mt-2 text-sm font-bold text-slate-400">
            Updates from QR scans and manual attendance records
          </p>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
            Latest Finish
          </p>
          <p className="mt-3 text-3xl font-black">
            {formatTime(data?.latest?.finishAt)}
          </p>
          <p className="mt-2 text-sm font-bold text-slate-400">
            Updates from QR and verified manual Finish records
          </p>
        </div>
      </section>

      <footer className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-center text-sm font-bold text-slate-400">
        Counts only. No participant names or private live locations are shown on this monitor. Powered by JRide Events.
      </footer>
    </main>
  );
}