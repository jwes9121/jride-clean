"use client";

import React, { useEffect, useMemo, useState } from "react";

type RideRow = {
  id: string;
  booking_code: string | null;
  status: string | null;
  passenger_name: string | null;
  from_label: string | null;
  to_label: string | null;
  town: string | null;
  assigned_driver_id: string | null;
  assigned_driver_name: string | null;
  assigned_driver_phone: string | null;
  proposed_fare: number | null;
  verified_fare: number | null;
  pickup_distance_fee: number | null;
  age_minutes: number;
  update_age_minutes: number;
  is_stuck: boolean;
  priority: number;
};

type DriverRow = {
  driver_id: string;
  name: string | null;
  phone: string | null;
  town: string | null;
  status: string | null;
  age_minutes: number | null;
  assign_eligible: boolean;
};

type PageData = {
  ok?: boolean;
  error?: string;
  message?: string;
  rides?: RideRow[];
  drivers?: DriverRow[];
  counts?: Record<string, number>;
};

const FILTERS = [
  "active",
  "unassigned",
  "searching",
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
  "stuck",
  "completed",
  "cancelled",
  "all",
];

const ACTIVE = new Set([
  "searching",
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
]);

function normStatus(value: any) {
  const s = String(value || "").trim().toLowerCase();
  if (!s || s === "requested" || s === "pending") return "searching";
  if (s === "driver_assigned") return "assigned";
  if (s === "accepted_by_driver") return "accepted";
  if (s === "en_route") return "on_the_way";
  if (s === "in_progress") return "on_trip";
  if (s === "canceled") return "cancelled";
  return s;
}

function titleCase(value: any) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function money(v: any) {
  const n = Number(v || 0);
  return n.toLocaleString("en-PH", { style: "currency", currency: "PHP" });
}

function pillClass(active: boolean) {
  return [
    "rounded-full border px-3 py-1 text-xs font-semibold",
    active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  ].join(" ");
}

function statusClass(status: string | null, stuck: boolean) {
  if (stuck) return "border-red-300 bg-red-50 text-red-700";
  const s = normStatus(status);
  if (s === "searching") return "border-amber-300 bg-amber-50 text-amber-800";
  if (s === "assigned" || s === "accepted") return "border-blue-300 bg-blue-50 text-blue-800";
  if (s === "fare_proposed") return "border-orange-300 bg-orange-50 text-orange-800";
  if (s === "ready") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (s === "on_the_way" || s === "arrived" || s === "on_trip") return "border-purple-300 bg-purple-50 text-purple-800";
  if (s === "completed") return "border-slate-300 bg-slate-50 text-slate-700";
  if (s === "cancelled") return "border-zinc-300 bg-zinc-50 text-zinc-700";
  return "border-slate-300 bg-slate-50 text-slate-700";
}

export default function RideDispatchPage() {
  const [filter, setFilter] = useState("active");
  const [rides, setRides] = useState<RideRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastAction, setLastAction] = useState("");
  const [selectedDrivers, setSelectedDrivers] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/ride-dispatch?filter=all", { cache: "no-store" });
      const j: PageData = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.message || j.error || "RIDE_DISPATCH_LOAD_FAILED");
      setRides(Array.isArray(j.rides) ? j.rides : []);
      setDrivers(Array.isArray(j.drivers) ? j.drivers : []);
    } catch (err: any) {
      setLastAction(err?.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = window.setInterval(() => load(), 8000);
    return () => window.clearInterval(t);
  }, []);

  async function postJson(url: string, body: any) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.message || j.error || "REQUEST_FAILED");
    return j;
  }

  async function assign(ride: RideRow) {
    const driverId = selectedDrivers[ride.id] || "";
    if (!driverId) {
      setLastAction("Select a driver first.");
      return;
    }

    const bookingCode = ride.booking_code || "";
    if (!bookingCode) {
      setLastAction("Missing booking code.");
      return;
    }

    setLastAction("Assigning ride...");
    try {
      await postJson("/api/dispatch/assign", { bookingCode, driverId });
      setLastAction("Ride assigned.");
      await load();
    } catch (err: any) {
      setLastAction(err?.message || "Assign failed");
    }
  }

  const counts = useMemo(() => {
    const next: Record<string, number> = {};
    for (const f of FILTERS) next[f] = 0;

    for (const ride of rides) {
      const s = normStatus(ride.status);
      next.all += 1;
      if (ACTIVE.has(s)) next.active += 1;
      if (ACTIVE.has(s) && !ride.assigned_driver_id) next.unassigned += 1;
      if (s === "searching") next.searching += 1;
      if (s === "assigned") next.assigned += 1;
      if (s === "accepted") next.accepted += 1;
      if (s === "fare_proposed") next.fare_proposed += 1;
      if (s === "ready") next.ready += 1;
      if (s === "on_the_way") next.on_the_way += 1;
      if (s === "arrived") next.arrived += 1;
      if (s === "on_trip") next.on_trip += 1;
      if (s === "completed") next.completed += 1;
      if (s === "cancelled") next.cancelled += 1;
      if (ride.is_stuck) next.stuck += 1;
    }

    return next;
  }, [rides]);

  const visibleRides = useMemo(() => {
    const filtered = rides.filter((ride) => {
      const s = normStatus(ride.status);
      if (filter === "all") return true;
      if (filter === "active") return ACTIVE.has(s);
      if (filter === "unassigned") return ACTIVE.has(s) && !ride.assigned_driver_id;
      if (filter === "stuck") return !!ride.is_stuck;
      if (filter === "cancelled") return s === "cancelled" || s === "canceled";
      return s === filter;
    });

    filtered.sort((a, b) => {
      if ((a.priority || 0) !== (b.priority || 0)) return (a.priority || 0) - (b.priority || 0);
      return Number(b.age_minutes || 0) - Number(a.age_minutes || 0);
    });

    return filtered;
  }, [rides, filter]);

  const eligibleDrivers = useMemo(() => drivers.filter((d) => d.assign_eligible), [drivers]);

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Ride Dispatch</h1>
              <p className="mt-1 text-sm text-slate-600">
                Manual ride assignment board. This is isolated from Takeout Dispatch and LiveTrips.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="rounded-full border bg-slate-50 px-3 py-1">Drivers available: {eligibleDrivers.length}</span>
              <button className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-slate-50" onClick={() => load()} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button key={f} type="button" className={pillClass(filter === f)} onClick={() => setFilter(f)}>
                {titleCase(f)} <span className="opacity-75">{counts[f] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Rule lock: ride dispatch uses ride statuses only. Do not mix takeout lifecycle, takeout fee, or vendor logic here.
          </div>

          {lastAction ? <div className="mt-3 rounded-xl border bg-slate-50 p-3 text-sm text-slate-700">{lastAction}</div> : null}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            {visibleRides.length === 0 ? (
              <div className="rounded-2xl border bg-white p-6 text-center text-sm text-slate-500">No rides in this view.</div>
            ) : (
              visibleRides.map((ride) => {
                const status = normStatus(ride.status);
                const fare = ride.verified_fare ?? ride.proposed_fare ?? null;
                return (
                  <article key={ride.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-bold">{ride.booking_code || ride.id}</h2>
                          <span className={["rounded-full border px-2 py-1 text-xs font-semibold", statusClass(status, ride.is_stuck)].join(" ")}>
                            {ride.is_stuck ? "STUCK - " : ""}{titleCase(status)}
                          </span>
                        </div>

                        <div className="grid gap-2 text-sm text-slate-700 md:grid-cols-2">
                          <div><span className="font-semibold">Passenger:</span> {ride.passenger_name || "Passenger"}</div>
                          <div><span className="font-semibold">Town:</span> {ride.town || "Unknown"}</div>
                          <div><span className="font-semibold">Age:</span> {ride.age_minutes} min</div>
                          <div><span className="font-semibold">Updated:</span> {ride.update_age_minutes} min ago</div>
                          <div><span className="font-semibold">Fare:</span> {fare == null ? "--" : money(fare)}</div>
                          <div><span className="font-semibold">Pickup fee:</span> {ride.pickup_distance_fee == null ? "--" : money(ride.pickup_distance_fee)}</div>
                          <div className="md:col-span-2"><span className="font-semibold">Pickup:</span> {ride.from_label || "Not provided"}</div>
                          <div className="md:col-span-2"><span className="font-semibold">Dropoff:</span> {ride.to_label || "Not provided"}</div>
                          <div className="md:col-span-2">
                            <span className="font-semibold">Assigned driver:</span> {ride.assigned_driver_name || "None"}{ride.assigned_driver_phone ? ` (${ride.assigned_driver_phone})` : ""}
                          </div>
                        </div>
                      </div>

                      <div className="w-full space-y-3 xl:w-[360px]">
                        <div className="rounded-xl border bg-slate-50 p-3">
                          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Manual assignment</div>
                          <div className="flex gap-2">
                            <select
                              className="min-w-0 flex-1 rounded-lg border bg-white px-2 py-2 text-sm"
                              value={selectedDrivers[ride.id] || ""}
                              onChange={(e) => setSelectedDrivers((prev) => ({ ...prev, [ride.id]: e.target.value }))}
                            >
                              <option value="">Select driver</option>
                              {eligibleDrivers.map((d) => (
                                <option key={d.driver_id} value={d.driver_id}>
                                  {d.name || d.driver_id} - {d.town || "No town"} - {d.status || "online"}
                                </option>
                              ))}
                            </select>
                            <button
                              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                              onClick={() => assign(ride)}
                              disabled={!selectedDrivers[ride.id] || !["searching", "assigned"].includes(status)}
                            >
                              Assign
                            </button>
                          </div>
                          <div className="mt-2 text-xs text-slate-500">
                            Assignment is allowed for searching or assigned rides only.
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          <aside className="space-y-3">
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <h3 className="font-bold">Driver pool</h3>
              <p className="mt-1 text-xs text-slate-500">
                Eligible drivers from latest driver_locations. Drivers already assigned to active rides are hidden.
              </p>
              <div className="mt-3 space-y-2">
                {eligibleDrivers.length === 0 ? (
                  <div className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-500">No eligible drivers available.</div>
                ) : (
                  eligibleDrivers.slice(0, 20).map((d) => (
                    <div key={d.driver_id} className="rounded-xl border p-3 text-sm">
                      <div className="font-semibold">{d.name || d.driver_id}</div>
                      <div className="text-xs text-slate-500">{d.town || "No town"} - {d.status || "online"} - {d.age_minutes ?? "?"} min</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
