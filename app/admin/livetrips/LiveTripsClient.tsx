// app/admin/livetrips/LiveTripsClient.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import LiveTripsMap from "./components/LiveTripsMap";
import SmartAutoAssignSuggestions from "./components/SmartAutoAssignSuggestions";
import TripWalletPanel from "./components/TripWalletPanel";
import TripLifecycleActions from "./components/TripLifecycleActions";

/**
 * Dispatcher-first LiveTrips client:
 * - Clickable status pills that FILTER list + map
 * - "Problem trips" pill focuses stuck/problem trips
 * - Live trips table includes key actions
 * - Fleet panel (drivers online/offline)
 */

type LiveTripRow = any;

type DriverRow = {
  driver_id?: string | null;
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
  status?: string | null;
  updated_at?: string | null;
  updated_at_ph?: string | null;
};

type FilterKey =
  | "all"
  | "dispatch"
  | "pending_fare"
  | "driver_accepted"
  | "on_the_way"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "problem";

function truthy(v: any) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function s(v: any): string {
  return String(v ?? "");
}

function statusEff(row: any): string {
  const st = s(row?.status ?? row?.trip_status ?? row?.status_eff).toLowerCase();
  if (!st) return "";
  return st;
}

function bookingCode(row: any): string {
  return s(row?.booking_code ?? row?.bookingCode ?? row?.id);
}

function nextLifecycleStatus(st: string): string {
  const x = s(st).toLowerCase();
  if (x === "dispatch") return "pending_fare";
  if (x === "pending_fare") return "driver_accepted";
  if (x === "driver_accepted") return "on_the_way";
  if (x === "on_the_way") return "arrived";
  if (x === "arrived") return "in_progress";
  if (x === "in_progress") return "completed";
  return x;
}

/* JRIDE_PH_TIME_FORMATTER_V7 */
function formatPHTime(input?: string | null): string {
  if (!input) return "-";
  const d = new Date(input);
  if (!Number.isFinite(d.getTime())) return String(input);
  return d.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
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
  const pollRef = useRef<any>(null);

  async function fetchPageData() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/livetrips/page-data", {
        method: "GET",
        headers: { "content-type": "application/json" },
        cache: "no-store",
      });
      const j = await res.json();

// --- JRIDE: fetch fleet drivers separately (page-data does not include drivers) ---
let driversPayload: any = null;
try {
  const drvRes = await fetch("/api/admin/driver_locations", {
    method: "GET",
    headers: { "content-type": "application/json" },
    cache: "no-store",
  });
  driversPayload = await drvRes.json();
} catch (e) {
  // ignore; keep drivers empty
  driversPayload = null;
}

const drvArr =
  Array.isArray(driversPayload) ? driversPayload :
  (Array.isArray((driversPayload as any)?.drivers) ? (driversPayload as any).drivers : []);

setDrivers(drvArr as any);
setDriversDebug(`loaded:${drvArr.length}`);
// --- end fleet drivers fetch ---
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);

      setTrips(Array.isArray(j?.trips) ? j.trips : []);
      const pageDrivers = (Array.isArray((j as any)?.drivers) ? ((j as any).drivers as any[]) : null);
if (pageDrivers && pageDrivers.length > 0) {
  setDrivers(pageDrivers as any);
  setDriversDebug(`loaded:${pageDrivers.length}`);
}

      // problem/stuck ids (if provided)
      if (Array.isArray(j?.stuck_trip_ids)) {
        const set = new Set<string>();
        for (const x of j.stuck_trip_ids) set.add(String(x));
        setStuckTripIds(set);
      } else {
        setStuckTripIds(new Set());
      }
    } catch (e: any) {
      setErr(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPageData();

    // poll every 3s
    pollRef.current = setInterval(() => {
      fetchPageData();
    }, 3000);

    return () => {
      try {
        clearInterval(pollRef.current);
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleTrips = useMemo(() => {
    const rows = trips ?? [];

    if (activeFilter === "all") return rows;

    if (activeFilter === "problem") {
      // stuck/problem
      return rows.filter((r) => {
        const code = bookingCode(r);
        return stuckTripIds.has(code) || truthy(r?.is_stuck) || truthy(r?.stuck);
      });
    }

    // normal status filter
    return rows.filter((r) => statusEff(r) === activeFilter);
  }, [trips, activeFilter, stuckTripIds]);

  const summary = useMemo(() => {
    const rows = trips ?? [];
    const counts: Record<string, number> = {
      all: rows.length,
      dispatch: 0,
      pending_fare: 0,
      driver_accepted: 0,
      on_the_way: 0,
      arrived: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
      problem: 0,
    };

    for (const r of rows) {
      const st = statusEff(r);
      if (counts[st] != null) counts[st] += 1;

      const code = bookingCode(r);
      const isProb = stuckTripIds.has(code) || truthy(r?.is_stuck) || truthy(r?.stuck);
      if (isProb) counts.problem += 1;
    }

    return counts;
  }, [trips, stuckTripIds]);

  const fleetCount = useMemo(() => (drivers ?? []).length, [drivers]);

  return (
    <div className="flex h-full w-full flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold">LiveTrips</div>

        <button
          className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
          onClick={() => fetchPageData()}
          disabled={loading}
        >
          Refresh
        </button>

        <div className="ml-auto text-xs text-gray-500">
          {loading ? "Loading..." : "Ready"}{" "}
          {err ? <span className="text-red-600">* {err}</span> : null}
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["dispatch", "Dispatch"],
            ["pending_fare", "Pending Fare"],
            ["driver_accepted", "Driver Accepted"],
            ["on_the_way", "On the way"],
            ["arrived", "Arrived"],
            ["in_progress", "In progress"],
            ["completed", "Completed"],
            ["cancelled", "Cancelled"],
            ["problem", "Problem"],
            ["all", "All"],
          ] as Array<[FilterKey, string]>
        ).map(([k, label]) => {
          const isOn = activeFilter === k;
          const n = summary[k] ?? 0;
          return (
            <button
              key={k}
              className={
                "rounded-full border px-3 py-1 text-xs " +
                (isOn ? "bg-black text-white" : "bg-white hover:bg-gray-50")
              }
              onClick={() => setActiveFilter(k)}
              title={`${label} (${n})`}
            >
              {label} <span className={isOn ? "text-white/80" : "text-gray-500"}>({n})</span>
            </button>
          );
        })}
      </div>

      {/* Debug row */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
        <div>Trips: {visibleTrips.length}</div>
        <div>Fleet: {fleetCount}</div>
        <div className="truncate">DriversDebug: {driversDebug}</div>
        <div className="truncate">LastAction: {lastAction}</div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Left: list */}
        <div className="lg:col-span-1">
          <div className="rounded-lg border bg-white">
            <div className="border-b p-2 text-sm font-semibold">Trips</div>

            <div className="max-h-[70vh] overflow-auto">
              {visibleTrips.length === 0 ? (
                <div className="p-3 text-sm text-gray-500">No trips for this filter.</div>
              ) : (
                <div className="divide-y">
                  {visibleTrips.map((t: any) => {
                    const code = bookingCode(t);
                    const st = statusEff(t);
                    const isSel = selectedTripId === code;
                    const isProb = stuckTripIds.has(code) || truthy(t?.is_stuck) || truthy(t?.stuck);

                    return (
                      <div
                        key={code || Math.random()}
                        className={"p-3 " + (isSel ? "bg-gray-50" : "bg-white")}
                        onClick={() => setSelectedTripId(code || null)}
                        style={{ cursor: "pointer" }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold">{code || "(no code)"}</div>
                          <div
                            className={
                              "rounded-full border px-2 py-0.5 text-[11px] " +
                              (isProb ? "border-red-300 bg-red-50 text-red-700" : "border-gray-200 bg-gray-50")
                            }
                          >
                            {isProb ? "PROBLEM" : st || "unknown"}
                          </div>
                        </div>

                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600">
                          <div className="truncate">From: {s(t?.from_label ?? t?.pickup_label ?? t?.from)}</div>
                          <div className="truncate">To: {s(t?.to_label ?? t?.dropoff_label ?? t?.to)}</div>
                          <div className="truncate">Town: {s(t?.town)}</div>
                          <div className="truncate">Fare: {s(t?.verified_fare ?? t?.proposed_fare ?? "")}</div>
                        </div>

                        <div className="mt-3">
                          <TripLifecycleActions
                            trip={t as any}
                            onAfterAction={() => setLastAction("action completed")}
                          />
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
  trip={(visibleTrips?.[0]) as any}
  drivers={drivers as any}
/>
            </div>
          </div>
        </div>

        {/* Right: map */}
        <div className="lg:col-span-2">
          <div className="rounded-lg border overflow-hidden">
            <LiveTripsMap
              trips={visibleTrips as any}
              selectedTripId={selectedTripId}
              stuckTripIds={stuckTripIds as any}
              drivers={drivers as any}
            />
          </div>
        </div>
      </div>
    </div>
  );
}