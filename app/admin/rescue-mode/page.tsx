"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type OverrideRow = {
  id: number;
  scope: string;
  target_town: string;
  reason: string;
  enabled_at: string;
  expires_at: string;
  disabled_at: string | null;
  created_by: string;
  disabled_by: string | null;
  created_at: string;
};

const TOWNS = ["Lagawe", "Lamut", "Banaue", "Hingyon", "Kiangan"];
const DURATIONS = [
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "4 hours" },
  { minutes: 480, label: "8 hours" },
  { minutes: 720, label: "12 hours" },
  { minutes: 1440, label: "24 hours" },
];

function displayTime(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function minutesRemaining(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 60000));
}

export default function RescueModePage() {
  const [town, setTown] = useState("Lagawe");
  const [durationMinutes, setDurationMinutes] = useState(240);
  const [reason, setReason] = useState("");
  const [active, setActive] = useState<OverrideRow[]>([]);
  const [recent, setRecent] = useState<OverrideRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setError("");
      const res = await fetch("/api/admin/service-rescue-mode", {
        method: "GET",
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({} as any));

      if (!res.ok || !payload?.ok) {
        throw new Error(String(payload?.message || payload?.error || "Failed to load Rescue Mode."));
      }

      setActive(Array.isArray(payload.active) ? payload.active : []);
      setRecent(Array.isArray(payload.recent) ? payload.recent : []);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load Rescue Mode."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = window.setInterval(load, 30000);
    const tick = window.setInterval(() => setClock(Date.now()), 30000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [load]);

  const activeByTown = useMemo(() => {
    const map = new Map<string, OverrideRow>();
    for (const row of active) map.set(row.target_town.toLowerCase(), row);
    return map;
  }, [active, clock]);

  async function enableRescueMode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/admin/service-rescue-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "enable",
          town,
          duration_minutes: durationMinutes,
          reason,
        }),
      });

      const payload = await res.json().catch(() => ({} as any));
      if (!res.ok || !payload?.ok) {
        throw new Error(String(payload?.message || payload?.error || "Could not enable Rescue Mode."));
      }

      setMessage(`${town} Rescue Mode enabled until ${displayTime(payload.override?.expires_at)}.`);
      setReason("");
      await load();
    } catch (e: any) {
      setError(String(e?.message || "Could not enable Rescue Mode."));
    } finally {
      setBusy(false);
    }
  }

  async function disableRescueMode(row: OverrideRow) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/admin/service-rescue-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "disable",
          id: row.id,
        }),
      });

      const payload = await res.json().catch(() => ({} as any));
      if (!res.ok || !payload?.ok) {
        throw new Error(String(payload?.message || payload?.error || "Could not disable Rescue Mode."));
      }

      setMessage(`${row.target_town} Rescue Mode turned off.`);
      await load();
    } catch (e: any) {
      setError(String(e?.message || "Could not disable Rescue Mode."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-amber-700">
              Admin operations
            </div>
            <h1 className="mt-1 text-2xl font-black text-slate-900">
              Non-Ride Town Rescue Mode
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Normal Takeout assignment uses the driver's latest current live town.
              Rescue Mode temporarily removes that current-town restriction for the selected
              target town so fresh, online drivers from other towns can help during a special
              event, shortage, emergency, or night operation.
            </p>
          </div>
          <a
            href="/admin/control-center"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
          >
            Back to Control Center
          </a>
        </div>

        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          <strong>Ride is never affected by this switch.</strong> Ride town exclusivity keeps
          its separate home/registered-town rules. Current enforcement on this page is Takeout.
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
          {message}
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-900">Enable temporary rescue</h2>
        <form className="mt-4 grid gap-4" onSubmit={enableRescueMode}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Target town
              <select
                value={town}
                onChange={(e) => setTown(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2"
              >
                {TOWNS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Automatically turn off after
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2"
              >
                {DURATIONS.map((item) => (
                  <option key={item.minutes} value={item.minutes}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Operational reason
            <textarea
              required
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Example: Provincial event in Lagawe; local Takeout driver supply is insufficient tonight."
              className="min-h-24 rounded-xl border border-slate-300 px-3 py-2"
            />
          </label>

          <button
            type="submit"
            disabled={busy || reason.trim().length < 5}
            className="rounded-xl bg-amber-600 px-4 py-3 text-sm font-black text-white disabled:bg-slate-300"
          >
            {busy ? "Saving..." : `Enable Rescue Mode for ${town}`}
          </button>

          <p className="text-xs text-slate-500">
            Rescue Mode does not force a driver to take the job. Existing fresh/online,
            availability, active-job, and nearest-driver checks still apply.
          </p>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-slate-900">Active rescue windows</h2>
          <button
            type="button"
            onClick={load}
            disabled={busy || loading}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700"
          >
            Refresh
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {loading ? <div className="text-sm text-slate-500">Loading...</div> : null}
          {!loading && active.length === 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              No town is currently in Rescue Mode. Normal current-town Takeout restriction is active.
            </div>
          ) : null}

          {active.map((row) => (
            <div key={row.id} className="rounded-xl border border-amber-300 bg-amber-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-base font-black text-amber-950">{row.target_town}</div>
                  <div className="mt-1 text-sm text-amber-900">{row.reason}</div>
                  <div className="mt-2 text-xs text-amber-800">
                    Enabled by {row.created_by} at {displayTime(row.enabled_at)}
                  </div>
                  <div className="mt-1 text-xs font-bold text-amber-900">
                    Expires {displayTime(row.expires_at)} ({minutesRemaining(row.expires_at)} min remaining)
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => disableRescueMode(row)}
                  className="rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-black text-rose-700 disabled:opacity-50"
                >
                  Turn off now
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-900">Recent rescue history</h2>
        <div className="mt-3 max-h-96 space-y-2 overflow-auto">
          {recent.length === 0 ? (
            <div className="text-sm text-slate-500">No Rescue Mode history yet.</div>
          ) : null}
          {recent.map((row) => {
            const isCurrentlyActive = activeByTown.get(row.target_town.toLowerCase())?.id === row.id;
            return (
              <div key={row.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">{row.target_town}</span>
                  <span
                    className={
                      "rounded-full px-2 py-1 text-xs font-bold " +
                      (isCurrentlyActive
                        ? "bg-amber-100 text-amber-900"
                        : "bg-slate-100 text-slate-600")
                    }
                  >
                    {isCurrentlyActive
                      ? "ACTIVE"
                      : row.disabled_at
                        ? "TURNED OFF"
                        : "EXPIRED"}
                  </span>
                </div>
                <div className="mt-1 text-slate-700">{row.reason}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {displayTime(row.enabled_at)} to {displayTime(row.expires_at)}
                </div>
                {row.disabled_at ? (
                  <div className="mt-1 text-xs text-slate-500">
                    Turned off {displayTime(row.disabled_at)}
                    {row.disabled_by ? ` by ${row.disabled_by}` : ""}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}