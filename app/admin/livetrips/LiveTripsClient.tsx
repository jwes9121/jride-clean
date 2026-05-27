// app/admin/livetrips/LiveTripsClient.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import LiveTripsMap from "./components/LiveTripsMap";
import SmartAutoAssignSuggestions from "./components/SmartAutoAssignSuggestions";
import TripWalletPanel from "./components/TripWalletPanel";
import TripLifecycleActions from "./components/TripLifecycleActions";

type LiveTripRow = Record<string, any>;

type DriverRow = {
  driver_id?: string | null;
  id?: string | null;
  name?: string | null;
  driver_name?: string | null;
  town?: string | null;
  zone?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  status?: string | null;
  updated_at?: string | null;
};

type FilterKey =
  | "dispatch"
  | "pending"
  | "assigned"
  | "on_the_way"
  | "arrived"
  | "on_trip"
  | "completed"
  | "cancelled"
  | "problem"
  | "all";

const ACTIVE_STATUSES = new Set([
  "requested",
  "searching",
  "pending",
  "assigned",
  "ready",
  "on_the_way",
  "arrived",
  "enroute",
  "on_trip",
  "in_progress",
]);

function truthy(v: any) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function s(v: any): string {
  return String(v ?? "");
}

function cleanStatus(v: any): string {
  return s(v).trim().toLowerCase();
}

function statusEff(row: any): string {
  return cleanStatus(row?.status ?? row?.trip_status ?? row?.status_eff ?? row?.customer_status ?? row?.vendor_status);
}

function statusGroup(row: any): FilterKey | "active" {
  const st = statusEff(row);
  if (st === "requested" || st === "searching" || st === "pending" || st === "dispatch") return "pending";
  if (st === "assigned" || st === "ready" || st === "driver_assigned" || st === "driver_accepted" || st === "pending_fare") return "assigned";
  if (st === "on_the_way" || st === "enroute") return "on_the_way";
  if (st === "arrived") return "arrived";
  if (st === "on_trip" || st === "in_progress") return "on_trip";
  if (st === "completed") return "completed";
  if (st === "cancelled" || st === "canceled") return "cancelled";
  return ACTIVE_STATUSES.has(st) ? "active" : "all";
}

function bookingCode(row: any): string {
  return s(row?.booking_code ?? row?.bookingCode ?? row?.code ?? row?.id).trim();
}

function rowId(row: any): string {
  return s(row?.id ?? row?.uuid ?? row?.booking_id ?? row?.bookingCode ?? row?.booking_code).trim();
}

function displayStatus(row: any): string {
  const st = statusEff(row);
  return st || "unknown";
}

function isProblemTrip(row: any, stuckTripIds: Set<string>): boolean {
  const code = bookingCode(row);
  const id = rowId(row);
  return (
    (code ? stuckTripIds.has(code) : false) ||
    (id ? stuckTripIds.has(id) : false) ||
    truthy(row?.is_stuck) ||
    truthy(row?.stuck) ||
    truthy(row?.isProblem)
  );
}

function tripTown(row: any): string {
  return s(row?.town ?? row?.zone ?? row?.zone_name ?? row?.municipality ?? "").trim();
}

function tripPickup(row: any): string {
  return s(row?.pickup_label ?? row?.from_label ?? row?.fromLabel ?? row?.from ?? "").trim();
}

function tripDropoff(row: any): string {
  return s(row?.dropoff_label ?? row?.to_label ?? row?.toLabel ?? row?.to ?? "").trim();
}

function passengerName(row: any): string {
  return s(row?.passenger_name ?? row?.passengerName ?? row?.customer_name ?? row?.rider_name ?? "").trim();
}

function money(row: any): string {
  const v = row?.verified_fare ?? row?.proposed_fare ?? row?.fare ?? row?.total_fare ?? "";
  return s(v).trim();
}

function newestFirst(a: any, b: any): number {
  const at = new Date(a?.updated_at ?? a?.created_at ?? 0).getTime() || 0;
  const bt = new Date(b?.updated_at ?? b?.created_at ?? 0).getTime() || 0;
  return bt - at;
}

export default function LiveTripsClient() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [trips, setTrips] = useState<LiveTripRow[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("dispatch");
  const [lastAction, setLastAction] = useState<string>("");

  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [driversDebug, setDriversDebug] = useState<string>("not-loaded");

  const [stuckTripIds, setStuckTripIds] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchDriversFromKnownEndpoint() {
    try {
      const paths = ["/api/admin/driver_locations", "/api/admin/driver-locations", "/api/admin/drivers"];
      for (const path of paths) {
        try {
          const res = await fetch(path, { method: "GET", cache: "no-store" });
          if (!res.ok) continue;
          const j = await res.json().catch(() => null);
          const arr = Array.isArray(j) ? j : Array.isArray(j?.drivers) ? j.drivers : Array.isArray(j?.data) ? j.data : [];
          if (Array.isArray(arr) && arr.length > 0) {
            setDrivers(arr as DriverRow[]);
            setDriversDebug(`loaded:${arr.length}:${path}`);
            return;
          }
        } catch {
          // try next endpoint
        }
      }
      setDrivers([]);
      setDriversDebug("loaded:0");
    } catch (e: any) {
      setDrivers([]);
      setDriversDebug(`driver-load-failed:${e?.message ?? "unknown"}`);
    }
  }

  async function fetchPageData() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/livetrips/page-data?debug=1", {
        method: "GET",
        headers: { "content-type": "application/json" },
        cache: "no-store",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message ?? j?.error ?? `HTTP ${res.status}`);

      const rows = Array.isArray(j?.trips)
        ? j.trips
        : Array.isArray(j?.bookings)
          ? j.bookings
          : Array.isArray(j?.data)
            ? j.data
            : [];

      const normalized = rows
        .map((r: any) => ({
          ...r,
          booking_code: r?.booking_code ?? r?.bookingCode ?? r?.code ?? null,
          pickup_label: r?.pickup_label ?? r?.from_label ?? r?.fromLabel ?? null,
          dropoff_label: r?.dropoff_label ?? r?.to_label ?? r?.toLabel ?? null,
          town: r?.town ?? r?.zone ?? r?.municipality ?? null,
          zone: r?.zone ?? r?.town ?? r?.municipality ?? null,
          status: r?.status ?? r?.trip_status ?? r?.status_eff ?? null,
        }))
        .sort(newestFirst);

      setTrips(normalized);

      const pageDrivers = Array.isArray(j?.drivers) ? j.drivers : [];
      if (pageDrivers.length > 0) {
        setDrivers(pageDrivers as DriverRow[]);
        setDriversDebug(`loaded:${pageDrivers.length}:page-data`);
      } else {
        await fetchDriversFromKnownEndpoint();
      }

      if (Array.isArray(j?.stuck_trip_ids)) {
        const set = new Set<string>();
        for (const x of j.stuck_trip_ids) set.add(String(x));
        setStuckTripIds(set);
      } else {
        setStuckTripIds(new Set());
      }

      if (j?.__debug?.rpc_fallback_used) {
        setLastAction("LiveTrips fallback active: RPC failed, bookings fallback served data");
      }
    } catch (e: any) {
      setErr(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function postJson(url: string, body: any) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.message ?? j?.error ?? `HTTP ${res.status}`);
    return j;
  }

  async function assignDriver(bookingCodeValue: string, driverId: string) {
    if (!bookingCodeValue || !driverId) return;
    setLastAction("Assigning driver...");
    await postJson("/api/dispatch/assign", { bookingCode: bookingCodeValue, driverId });
    setLastAction("Driver assigned");
    await fetchPageData();
  }

  useEffect(() => {
    void fetchPageData();
    pollRef.current = setInterval(() => {
      void fetchPageData();
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleTrips = useMemo(() => {
    const rows = trips ?? [];
    if (activeFilter === "all") return rows;
    if (activeFilter === "dispatch") {
      return rows.filter((r) => ACTIVE_STATUSES.has(statusEff(r)) || ["pending", "assigned", "on_the_way", "arrived", "on_trip", "active"].includes(statusGroup(r)));
    }
    if (activeFilter === "problem") return rows.filter((r) => isProblemTrip(r, stuckTripIds));
    return rows.filter((r) => statusGroup(r) === activeFilter);
  }, [trips, activeFilter, stuckTripIds]);

  const selectedTrip = useMemo(() => {
    if (!selectedTripId) return null;
    return trips.find((r) => rowId(r) === selectedTripId || bookingCode(r) === selectedTripId) ?? null;
  }, [trips, selectedTripId]);

  const summary = useMemo(() => {
    const counts: Record<FilterKey, number> = {
      dispatch: 0,
      pending: 0,
      assigned: 0,
      on_the_way: 0,
      arrived: 0,
      on_trip: 0,
      completed: 0,
      cancelled: 0,
      problem: 0,
      all: trips.length,
    };

    for (const row of trips) {
      const group = statusGroup(row);
      if (group === "active") counts.dispatch += 1;
      if (group in counts) counts[group as FilterKey] += 1;
      if (["pending", "assigned", "on_the_way", "arrived", "on_trip"].includes(group)) counts.dispatch += 1;
      if (isProblemTrip(row, stuckTripIds)) counts.problem += 1;
    }

    return counts;
  }, [trips, stuckTripIds]);

  const fleetCount = useMemo(() => (drivers ?? []).length, [drivers]);

  const filterPills: Array<[FilterKey, string]> = [
    ["dispatch", "Dispatch"],
    ["pending", "Pending"],
    ["assigned", "Assigned"],
    ["on_the_way", "On the way"],
    ["arrived", "Arrived"],
    ["on_trip", "On trip"],
    ["completed", "Completed"],
    ["cancelled", "Cancelled"],
    ["problem", "Problem"],
    ["all", "All"],
  ];

  return (
    <div className="flex h-full w-full flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold">LiveTrips</div>

        <button
          className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
          onClick={() => void fetchPageData()}
          disabled={loading}
          type="button"
        >
          Refresh
        </button>

        <div className="ml-auto text-xs text-gray-500">
          {loading ? "Loading..." : "Ready"} {err ? <span className="text-red-600">- {err}</span> : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {filterPills.map(([k, label]) => {
          const isOn = activeFilter === k;
          const n = summary[k] ?? 0;
          return (
            <button
              key={k}
              className={"rounded-full border px-3 py-1 text-xs " + (isOn ? "bg-black text-white" : "bg-white hover:bg-gray-50")}
              onClick={() => setActiveFilter(k)}
              title={`${label} (${n})`}
              type="button"
            >
              {label} <span className={isOn ? "text-white/80" : "text-gray-500"}>({n})</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
        <div>Shown: {visibleTrips.length}</div>
        <div>Total: {trips.length}</div>
        <div>Fleet: {fleetCount}</div>
        <div className="truncate">Drivers: {driversDebug}</div>
        <div className="truncate">Last action: {lastAction || "none"}</div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <div className="rounded-lg border bg-white">
            <div className="border-b p-2 text-sm font-semibold">Trips</div>

            <div className="max-h-[70vh] overflow-auto">
              {visibleTrips.length === 0 ? (
                <div className="p-3 text-sm text-gray-500">No trips for this filter.</div>
              ) : (
                <div className="divide-y">
                  {visibleTrips.map((t: any, idx: number) => {
                    const code = bookingCode(t);
                    const id = rowId(t) || code || String(idx);
                    const st = displayStatus(t);
                    const isSel = selectedTripId === id || selectedTripId === code;
                    const isProb = isProblemTrip(t, stuckTripIds);

                    return (
                      <div
                        key={id}
                        className={"p-3 " + (isSel ? "bg-gray-50" : "bg-white")}
                        onClick={() => setSelectedTripId(id || code || null)}
                        style={{ cursor: "pointer" }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold">{code || "(no code)"}</div>
                          <div className={"rounded-full border px-2 py-0.5 text-[11px] " + (isProb ? "border-red-300 bg-red-50 text-red-700" : "border-gray-200 bg-gray-50")}>
                            {isProb ? "PROBLEM" : st}
                          </div>
                        </div>

                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600">
                          <div className="truncate">Passenger: {passengerName(t) || "-"}</div>
                          <div className="truncate">Town: {tripTown(t) || "-"}</div>
                          <div className="truncate">From: {tripPickup(t) || "-"}</div>
                          <div className="truncate">To: {tripDropoff(t) || "-"}</div>
                          <div className="truncate">Fare: {money(t) || "-"}</div>
                          <div className="truncate">Driver: {s(t?.driver_name ?? t?.driver_id ?? t?.assigned_driver_id ?? "-")}</div>
                        </div>

                        <div className="mt-3">
                          <TripLifecycleActions trip={t as any} onAfterAction={() => setLastAction("action completed")} />
                        </div>

                        <div className="mt-3">
                          <TripWalletPanel trip={t as any} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 rounded-lg border bg-white">
            <div className="border-b p-2 text-sm font-semibold">Auto-Assign Suggestions</div>
            <div className="p-2">
              <SmartAutoAssignSuggestions
                trip={(selectedTrip ?? visibleTrips?.[0] ?? null) as any}
                drivers={drivers as any}
                onAssign={(driverId) => {
                  const row = selectedTrip ?? visibleTrips?.[0] ?? null;
                  const code = row ? bookingCode(row) : "";
                  return assignDriver(code, driverId);
                }}
                assignedDriverId={(selectedTrip as any)?.driver_id ?? (selectedTrip as any)?.assigned_driver_id ?? null}
              />
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="h-[70vh] overflow-hidden rounded-lg border bg-white">
            <LiveTripsMap trips={visibleTrips as any} selectedTripId={selectedTripId} stuckTripIds={stuckTripIds as any} drivers={drivers as any} />
          </div>
        </div>
      </div>
    </div>
  );
}
