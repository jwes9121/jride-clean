"use client";

import * as React from "react";
import { philippinesTime } from "@/lib/jfleet/routeReview";

type Payload = {
  ok?: boolean;
  enabled?: boolean;
  events?: any[];
  bookings?: any[];
  partners?: any[];
  drivers?: any[];
  vehicles?: any[];
  locations?: any[];
  server_now?: string;
  error?: string;
};

function title(value: string) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AdminJfleetSecurityPage() {
  const [data, setData] = React.useState<Payload | null>(null);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      const response = await fetch("/api/admin/jfleet/security", {
        cache: "no-store",
        credentials: "include",
      });
      const body = (await response.json().catch(() => ({}))) as Payload;
      if (!response.ok || body?.ok !== true) {
        throw new Error(body?.error || "Could not load JFleet security.");
      }
      setData(body);
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not load JFleet security."
      );
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const bookings = new Map((data?.bookings ?? []).map((row) => [row.id, row]));
  const partners = new Map((data?.partners ?? []).map((row) => [row.id, row]));
  const drivers = new Map((data?.drivers ?? []).map((row) => [row.id, row]));
  const vehicles = new Map((data?.vehicles ?? []).map((row) => [row.id, row]));

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="rounded-2xl bg-slate-950 p-6 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">
            JRide Operations
          </p>
          <h1 className="mt-1 text-3xl font-bold">JFleet Security Alerts</h1>
          <p className="mt-2 text-sm text-slate-300">
            Cross-partner route deviation and GPS continuity feed
          </p>
        </header>

        <button type="button" onClick={() => void load()} className="rounded-xl border bg-white px-4 py-2 font-semibold">
          Refresh
        </button>

        {error ? (
          <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>
        ) : null}

        {data?.enabled === false ? (
          <div className="rounded-xl bg-amber-50 p-4 text-amber-950">
            JFleet is currently disabled. No live JFleet security alerts are expected.
          </div>
        ) : null}

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Active Alerts</h2>
          {(data?.events ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">No active JFleet alert.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {(data?.events ?? []).map((event) => {
                const booking = bookings.get(event.booking_id);
                const partner = booking ? partners.get(booking.partner_id) : null;
                const driver = drivers.get(event.driver_id);
                const vehicle = booking?.assigned_vehicle_id
                  ? vehicles.get(booking.assigned_vehicle_id)
                  : null;
                return (
                  <article
                    key={event.id}
                    className={
                      "rounded-xl border p-4 " +
                      (event.severity === "critical"
                        ? "border-red-300 bg-red-50"
                        : "border-amber-300 bg-amber-50")
                    }
                  >
                    <div className="flex flex-wrap justify-between gap-3">
                      <div>
                        <strong>{partner?.display_name || "JFleet Partner"}</strong>
                        <p className="text-sm">
                          {(booking?.booking_code || event.booking_id) + " - " + title(event.event_type)}
                        </p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold">
                        {title(event.severity)}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                      <p>Driver: {driver?.full_name || "-"}</p>
                      <p>Vehicle: {vehicle?.plate_number || "-"}</p>
                      <p>Last observed: {philippinesTime(event.last_observed_at)}</p>
                      <p>Distance: {event.deviation_distance_m == null ? "-" : String(Math.round(Number(event.deviation_distance_m))) + " m"}</p>
                      <p>Status: {title(event.event_status)}</p>
                      <p>Occurrences: {event.occurrence_count}</p>
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
