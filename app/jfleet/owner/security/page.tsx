"use client";

import * as React from "react";
import Link from "next/link";
import { philippinesTime } from "@/lib/jfleet/routeReview";

type SecurityEvent = {
  id: string;
  booking_id: string;
  driver_id: string;
  event_type: string;
  event_status: string;
  severity: string;
  deviation_distance_m?: number | string | null;
  first_observed_at: string;
  last_observed_at: string;
  occurrence_count: number;
  acknowledged_at?: string | null;
  details?: Record<string, unknown> | null;
};

type Payload = {
  ok?: boolean;
  partner?: { id: string; display_name: string };
  policy?: { enabled?: boolean; [key: string]: unknown };
  events?: SecurityEvent[];
  bookings?: any[];
  states?: any[];
  locations?: any[];
  drivers?: any[];
  vehicles?: any[];
  server_now?: string;
  message?: string;
};

function title(value: string) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function ageSeconds(iso?: string | null, nowIso?: string | null) {
  if (!iso) return null;
  const a = Date.parse(iso);
  const b = nowIso ? Date.parse(nowIso) : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((b - a) / 1000));
}

export default function JFleetOwnerSecurityPage() {
  const [data, setData] = React.useState<Payload | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [reasons, setReasons] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    try {
      const response = await fetch("/api/jfleet/owner/security", {
        cache: "no-store",
        credentials: "include",
      });
      const body = (await response.json().catch(() => ({}))) as Payload;
      if (!response.ok || !body?.ok) {
        throw new Error(body?.message || "Could not load JFleet security monitoring.");
      }
      setData(body);
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not load JFleet security monitoring."
      );
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function act(eventId: string, action: string) {
    if (busy) return;
    setBusy(eventId + ":" + action);
    setError("");
    try {
      const response = await fetch("/api/jfleet/owner/security", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: eventId,
          action,
          reason: reasons[eventId] || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) {
        throw new Error(body?.message || "Security alert update failed.");
      }
      await load();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Security alert update failed."
      );
    } finally {
      setBusy("");
    }
  }

  const bookings = new Map((data?.bookings ?? []).map((row) => [row.id, row]));
  const drivers = new Map((data?.drivers ?? []).map((row) => [row.id, row]));
  const vehicles = new Map((data?.vehicles ?? []).map((row) => [row.id, row]));
  const locations = new Map(
    (data?.locations ?? []).map((row) => [row.booking_id, row])
  );
  const states = new Map((data?.states ?? []).map((row) => [row.booking_id, row]));

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="rounded-2xl bg-slate-950 p-6 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">
            JFleet Security
          </p>
          <h1 className="mt-1 text-3xl font-bold">
            {data?.partner?.display_name || "Transport Partner"}
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            Approved-route and GPS continuity monitoring
          </p>
        </header>

        <div className="flex flex-wrap gap-2">
          <Link href="/jfleet/owner" className="rounded-xl border bg-white px-4 py-2 font-semibold">
            Back to Owner Portal
          </Link>
          <button type="button" onClick={() => void load()} className="rounded-xl border bg-white px-4 py-2 font-semibold">
            Refresh
          </button>
        </div>

        {error ? (
          <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>
        ) : null}

        {data && data.policy?.enabled !== true ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <strong>Security thresholds are not enabled yet.</strong>
            <p className="mt-1 text-sm">
              GPS can be collected, but JRide has not yet configured the distance,
              persistence, accuracy and tracking-gap thresholds for this partner.
            </p>
          </div>
        ) : null}

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">Active Security Alerts</h2>
              <p className="mt-1 text-sm text-slate-600">
                Route deviations, missing GPS and monitoring pauses.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold">
              {(data?.events ?? []).length}
            </span>
          </div>

          {(data?.events ?? []).length === 0 ? (
            <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              No active JFleet security alert.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {(data?.events ?? []).map((event) => {
                const booking = bookings.get(event.booking_id);
                const driver = drivers.get(event.driver_id);
                const vehicle = booking?.assigned_vehicle_id
                  ? vehicles.get(booking.assigned_vehicle_id)
                  : null;
                const location = locations.get(event.booking_id);
                const state = states.get(event.booking_id);
                const gpsAge = ageSeconds(location?.captured_at, data?.server_now);
                const vehicleLabel = vehicle
                  ? String(vehicle.unit_code || "") + " / " + String(vehicle.plate_number || "")
                  : "-";

                return (
                  <article
                    key={event.id}
                    className={
                      "rounded-2xl border p-4 " +
                      (event.severity === "critical"
                        ? "border-red-300 bg-red-50"
                        : "border-amber-300 bg-amber-50")
                    }
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase text-slate-500">
                          {booking?.booking_code || event.booking_id}
                        </p>
                        <h3 className="mt-1 text-lg font-bold">{title(event.event_type)}</h3>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold">
                        {title(event.severity)} - {title(event.event_status)}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <p><strong>Driver:</strong> {driver?.full_name || "-"}</p>
                      <p><strong>Vehicle:</strong> {vehicleLabel}</p>
                      <p><strong>Last observed:</strong> {philippinesTime(event.last_observed_at)}</p>
                      <p><strong>GPS age:</strong> {gpsAge == null ? "No GPS" : String(gpsAge) + " sec"}</p>
                      <p><strong>Distance from approved route:</strong> {event.deviation_distance_m == null ? "-" : String(Math.round(Number(event.deviation_distance_m))) + " m"}</p>
                      <p><strong>Occurrences:</strong> {event.occurrence_count}</p>
                    </div>

                    {state?.monitoring_paused_reason ? (
                      <p className="mt-3 rounded-lg bg-white p-2 text-sm">
                        <strong>Monitoring paused:</strong> {title(state.monitoring_paused_reason)}
                      </p>
                    ) : null}

                    <input
                      value={reasons[event.id] || ""}
                      onChange={(e) =>
                        setReasons((current) => ({ ...current, [event.id]: e.target.value }))
                      }
                      placeholder="Reason required for resolve / approved detour"
                      className="mt-3 w-full rounded-lg border bg-white px-3 py-2 text-sm"
                      maxLength={1000}
                    />

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" disabled={!!busy} onClick={() => void act(event.id, "acknowledge")} className="rounded-lg border bg-white px-3 py-2 text-sm font-bold disabled:opacity-50">
                        Acknowledge
                      </button>
                      {event.event_type === "route_deviation" ? (
                        <button type="button" disabled={!!busy} onClick={() => void act(event.id, "approve_detour")} className="rounded-lg bg-violet-800 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
                          Approve Detour
                        </button>
                      ) : null}
                      <button type="button" disabled={!!busy} onClick={() => void act(event.id, "resolve")} className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
                        Resolve
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
