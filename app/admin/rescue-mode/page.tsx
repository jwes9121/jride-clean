"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

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

function minutesRemaining(value: string) {
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 60000));
}

export default function RideRescueModePage() {
  const [town, setTown] = useState("Lagawe");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [reason, setReason] = useState("");
  const [active, setActive] = useState<OverrideRow[]>([]);
  const [recent, setRecent] = useState<OverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const res = await fetch("/api/admin/service-rescue-mode", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = await res.json().catch(() => ({} as any));
      if (!res.ok || !payload?.ok) {
        throw new Error(String(payload?.message || payload?.error || "Failed to load Ride Rescue Mode."));
      }
      setActive(Array.isArray(payload.active) ? payload.active : []);
      setRecent(Array.isArray(payload.recent) ? payload.recent : []);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load Ride Rescue Mode."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = window.setInterval(load, 30000);
    return () => window.clearInterval(poll);
  }, [load]);

  async function enable(event: FormEvent) {
    event.preventDefault();

    const durationLabel =
      DURATIONS.find((item) => item.minutes === durationMinutes)?.label ||
      `${durationMinutes} minutes`;

    const confirmed = window.confirm(
      `Enable Ride Rescue Mode for ${town} for ${durationLabel}?\n\n` +
        `Visiting JRide drivers will only become eligible after their live GPS location is inside ${town}. ` +
        `Their registered town will be temporarily ignored for NEW ride assignments.`
    );
    if (!confirmed) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/admin/service-rescue-mode", {
        method: "POST",
        credentials: "same-origin",
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
        throw new Error(String(payload?.message || payload?.error || "Could not enable Ride Rescue Mode."));
      }

      setReason("");
      setMessage(`${town} Ride Rescue Mode enabled until ${displayTime(payload.override?.expires_at)}.`);
      await load();
    } catch (e: any) {
      setError(String(e?.message || "Could not enable Ride Rescue Mode."));
    } finally {
      setBusy(false);
    }
  }

  async function disable(row: OverrideRow) {
    if (!window.confirm(`Turn off Ride Rescue Mode for ${row.target_town} now?`)) return;

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/admin/service-rescue-mode", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable", id: row.id }),
      });
      const payload = await res.json().catch(() => ({} as any));
      if (!res.ok || !payload?.ok) {
        throw new Error(String(payload?.message || payload?.error || "Could not disable Ride Rescue Mode."));
      }
      setMessage(`${row.target_town} Ride Rescue Mode turned off.`);
      await load();
    } catch (e: any) {
      setError(String(e?.message || "Could not disable Ride Rescue Mode."));
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
              Ride Town Rescue Mode
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Use this only when a town temporarily lacks enough Ride drivers, such as during a
              special event or night operation. Drivers from other JRide towns must physically
              travel into the target town first. Their fresh live GPS location must be in the
              target town before they can receive new rides there.
            </p>
          </div>
          <a
            href="/admin/control-center"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
          >
            Back to Control Center
          </a>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
            <strong>Normal Ride rule:</strong> registered/service town and current live town must
            both match the passenger pickup town.
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <strong>During Rescue Mode:</strong> current live town must still match the target
            town, but the driver's registered town is temporarily waived for new Ride bookings.
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <strong>Not used for Takeout, Errand or AgriMarket.</strong> Those services are
          location/proximity based and do not use Ride town exclusivity.
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
        <h2 className="text-lg font-black text-slate-900">Enable temporary Ride rescue</h2>

        <form className="mt-4 grid gap-4" onSubmit={enable}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Town needing additional Ride drivers
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
              placeholder="Example: Provincial event in Lagawe; local Ride driver supply is insufficient tonight."
              className="min-h-24 rounded-xl border border-slate-300 px-3 py-2"
            />
          </label>

          <button
            type="submit"
            disabled={busy || reason.trim().length < 5}
            className="rounded-xl bg-amber-600 px-4 py-3 text-sm font-black text-white disabled:bg-slate-300"
          >
            {busy ? "Saving..." : `Enable Ride Rescue Mode for ${town}`}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-slate-900">Active Ride rescue windows</h2>
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
              No Ride Rescue Mode is active. Normal Ride town exclusivity is in force.
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
                  onClick={() => disable(row)}
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
        <h2 className="text-lg font-black text-slate-900">Recent Ride rescue history</h2>
        <div className="mt-3 max-h-96 space-y-2 overflow-auto">
          {recent.length === 0 ? (
            <div className="text-sm text-slate-500">No Ride Rescue Mode history yet.</div>
          ) : null}

          {recent.map((row) => {
            const currentlyActive = active.some((item) => item.id === row.id);
            return (
              <div key={row.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">{row.target_town}</span>
                  <span
                    className={
                      "rounded-full px-2 py-1 text-xs font-bold " +
                      (currentlyActive
                        ? "bg-amber-100 text-amber-900"
                        : "bg-slate-100 text-slate-600")
                    }
                  >
                    {currentlyActive ? "ACTIVE" : row.disabled_at ? "TURNED OFF" : "EXPIRED"}
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