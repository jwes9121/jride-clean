"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import LiveTripsMap from "./components/LiveTripsMap";
import SmartAutoAssignSuggestions from "./components/SmartAutoAssignSuggestions";
import TripWalletPanel from "./components/TripWalletPanel";
import TripLifecycleActions from "./components/TripLifecycleActions";

type LiveTripRow = any;

type DriverRow = {
  driver_id?: string | null;
  id?: string | null;
  full_name?: string | null;
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
  status?: string | null;
  effective_status?: string | null;
  updated_at?: string | null;
  updated_at_ph?: string | null;
  town?: string | null;
  home_town?: string | null;
  municipality?: string | null;
  zone?: string | null;
  age_seconds?: number | null;
  is_stale?: boolean | null;
  assign_fresh?: boolean | null;
  assign_online_eligible?: boolean | null;
  assign_eligible?: boolean | null;
  completed_trips_count?: number | null;
  cancelled_trips_count?: number | null;
  active_booking_id?: string | null;
  active_booking_code?: string | null;
  active_booking_status?: string | null;
  active_booking_town?: string | null;
  active_booking_updated_at?: string | null;
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

type MainTab = "trips" | "drivers";
type DriverFilterKey = "all" | "online_eligible" | "assigned" | "on_trip" | "stale" | "offline";

function truthy(v: any) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function s(v: any): string {
  return String(v ?? "");
}

function n(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function statusEff(row: any): string {
  const st = s(row?.status ?? row?.trip_status ?? row?.status_eff).toLowerCase();
  if (!st) return "";
  return st;
}

function bookingCode(row: any): string {
  return s(row?.booking_code ?? row?.bookingCode ?? row?.id);
}

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

function formatAgo(ageSeconds: number | null | undefined): string {
  const v = Number(ageSeconds);
  if (!Number.isFinite(v) || v < 0) return "-";
  if (v < 60) return `${Math.floor(v)}s ago`;
  if (v < 3600) return `${Math.floor(v / 60)}m ago`;
  return `${Math.floor(v / 3600)}h ${Math.floor((v % 3600) / 60)}m ago`;
}

function normalizeTripForSuggestions(t: any) {
  if (!t) return null;

  const pickupLat =
    n(t?.pickupLat) ??
    n(t?.pickup_lat) ??
    n(t?.from_lat) ??
    n(t?.origin_lat);

  const pickupLng =
    n(t?.pickupLng) ??
    n(t?.pickup_lng) ??
    n(t?.from_lng) ??
    n(t?.origin_lng);

  const zone =
    s(t?.zone ?? t?.town ?? t?.municipality ?? t?.area).trim() || "Unknown";

  const tripType =
    s(t?.tripType ?? t?.trip_type ?? t?.service_type ?? t?.serviceType).trim() || "ride";

  return {
    id: s(t?.id ?? t?.booking_id ?? t?.booking_code),
    pickupLat: pickupLat ?? 0,
    pickupLng: pickupLng ?? 0,
    zone,
    tripType,
  };
}

function normalizeDriversForSuggestions(rows: DriverRow[]) {
  return (rows ?? [])
    .map((d) => {
      const id = s(d?.driver_id ?? d?.id).trim();
      const lat = n(d?.lat);
      const lng = n(d?.lng);
      if (!id || lat == null || lng == null) return null;

      const homeTown =
        s(d?.home_town ?? d?.municipality ?? d?.town ?? d?.zone).trim() || "Unknown";

      const zone =
        s(d?.zone ?? d?.town ?? d?.home_town ?? d?.municipality).trim() || "Unknown";

      const status =
        s(d?.effective_status ?? d?.status).trim() || "unknown";

      return {
        id,
        name: s(d?.name ?? d?.full_name ?? d?.driver_id ?? d?.id).trim() || id,
        lat,
        lng,
        zone,
        homeTown,
        status,
      };
    })
    .filter(Boolean) as Array<{
      id: string;
      name: string;
      lat: number;
      lng: number;
      zone: string;
      homeTown: string;
      status: string;
    }>;
}

function driverTown(d: DriverRow): string {
  return s(d?.town ?? d?.home_town ?? d?.municipality ?? d?.zone).trim();
}

function driverDisplayName(d: DriverRow): string {
  return s(d?.full_name ?? d?.name ?? d?.driver_id ?? d?.id).trim() || "(unnamed)";
}

function driverStatusBucket(d: DriverRow): DriverFilterKey {
  const raw = s(d?.status).toLowerCase().trim();
  const eff = s(d?.effective_status).toLowerCase().trim();
  const active = s(d?.active_booking_status).toLowerCase().trim();
  const assignEligible = truthy(d?.assign_eligible);

  if (assignEligible) return "online_eligible";
  if (active === "on_trip" || active === "completed" || active === "enroute") return "on_trip";
  if (active === "assigned" || active === "accepted" || active === "on_the_way" || active === "arrived" || active === "fare_proposed") return "assigned";
  if (eff === "stale" || truthy(d?.is_stale)) return "stale";
  if (raw === "offline" || raw === "logout" || raw === "logged_out") return "offline";
  return "offline";
}

function onlineEligibleSortScore(d: DriverRow): number {
  const bucket = driverStatusBucket(d);
  if (bucket === "online_eligible") return 0;
  if (bucket === "assigned") return 1;
  if (bucket === "on_trip") return 2;
  if (bucket === "stale") return 3;
  return 4;
}

function compareDrivers(a: DriverRow, b: DriverRow): number {
  const sa = onlineEligibleSortScore(a);
  const sb = onlineEligibleSortScore(b);
  if (sa !== sb) return sa - sb;

  const aa = Number(a?.age_seconds ?? Number.MAX_SAFE_INTEGER);
  const bb = Number(b?.age_seconds ?? Number.MAX_SAFE_INTEGER);
  if (aa !== bb) return aa - bb;

  return driverDisplayName(a).localeCompare(driverDisplayName(b));
}

function filterDriverByTown(d: DriverRow, town: string): boolean {
  if (!town || town === "All") return true;
  return driverTown(d).toLowerCase() === town.toLowerCase();
}

function filterDriverBySearch(d: DriverRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    driverDisplayName(d),
    s(d?.driver_id),
    driverTown(d),
    s(d?.active_booking_code),
    s(d?.active_booking_status),
  ].join(" ").toLowerCase();
  return hay.includes(needle);
}

function kpiCounts(drivers: DriverRow[]) {
  return {
    online_eligible: drivers.filter((d) => driverStatusBucket(d) === "online_eligible").length,
    assigned: drivers.filter((d) => driverStatusBucket(d) === "assigned").length,
    on_trip: drivers.filter((d) => driverStatusBucket(d) === "on_trip").length,
    stale: drivers.filter((d) => driverStatusBucket(d) === "stale").length,
    offline: drivers.filter((d) => driverStatusBucket(d) === "offline").length,
  };
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
  const [assigningDriverId, setAssigningDriverId] = useState<string | null>(null);

  const [stuckTripIds, setStuckTripIds] = useState<Set<string>>(new Set());
  const [mainTab, setMainTab] = useState<MainTab>("trips");
  const [driverTownFilter, setDriverTownFilter] = useState<string>("All");
  const [driverStatusFilter, setDriverStatusFilter] = useState<DriverFilterKey>("all");
  const [driverSearch, setDriverSearch] = useState<string>("");
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

  const pollRef = useRef<any>(null);

  async function fetchPageData() {
    setLoading(true);
    setErr(null);

    try {
      const [pageRes, driverRes] = await Promise.all([
        fetch("/api/admin/livetrips/page-data", {
          method: "GET",
          headers: { "content-type": "application/json" },
          cache: "no-store",
        }),
        fetch("/api/admin/livetrips/drivers-summary", {
          method: "GET",
          headers: { "content-type": "application/json" },
          cache: "no-store",
        }),
      ]);

      const j = await pageRes.json().catch(() => ({}));
      const dj = await driverRes.json().catch(() => ({}));

      if (!pageRes.ok) throw new Error(j?.error ?? j?.message ?? `HTTP ${pageRes.status}`);
      if (!driverRes.ok) throw new Error(dj?.error ?? dj?.message ?? `HTTP ${driverRes.status}`);

      const nextTrips = Array.isArray(j?.trips) ? j.trips : [];
      const nextDrivers = Array.isArray(dj?.drivers) ? (dj.drivers as DriverRow[]) : [];

      setTrips(nextTrips);
      setDrivers(nextDrivers);
      setDriversDebug(`loaded:${nextDrivers.length}`);

      if (Array.isArray(j?.stuck_trip_ids)) {
        const set = new Set<string>();
        for (const x of j.stuck_trip_ids) set.add(String(x));
        setStuckTripIds(set);
      } else {
        setStuckTripIds(new Set());
      }

      if (!selectedTripId && nextTrips.length > 0) {
        setSelectedTripId(bookingCode(nextTrips[0]));
      }

      if (!selectedDriverId && nextDrivers.length > 0) {
        const first = [...nextDrivers].sort(compareDrivers)[0];
        setSelectedDriverId(String(first?.driver_id ?? first?.id ?? ""));
      }
    } catch (e: any) {
      setErr(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleAssign(driverId: string) {
    const selectedTrip =
      (visibleTrips ?? []).find((t: any) => bookingCode(t) === selectedTripId) ??
      (visibleTrips?.[0] ?? null);

    if (!selectedTrip) {
      setLastAction("assign blocked: no selected trip");
      return;
    }

    const booking_code = s(selectedTrip?.booking_code).trim();
    const booking_id = s(selectedTrip?.id).trim();

    if (!booking_code && !booking_id) {
      setLastAction("assign blocked: missing booking identifier");
      return;
    }

    setAssigningDriverId(driverId);
    setErr(null);

    try {
      const res = await fetch("/api/dispatch/assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          booking_code: booking_code || undefined,
          booking_id: booking_id || undefined,
          driver_id: driverId,
        }),
      });

      const j = await res.json().catch(() => ({}));

      if (!res.ok || j?.ok === false) {
        throw new Error(j?.message ?? j?.error ?? j?.code ?? `HTTP ${res.status}`);
      }

      setLastAction(
        `assigned ${driverId} to ${booking_code || booking_id} at ${formatPHTime(new Date().toISOString())}`
      );

      await fetchPageData();
    } catch (e: any) {
      const msg = e?.message ?? "Assignment failed";
      setErr(msg);
      setLastAction(`assign failed: ${msg}`);
    } finally {
      setAssigningDriverId(null);
    }
  }

  useEffect(() => {
    fetchPageData();

    pollRef.current = setInterval(() => {
      fetchPageData();
    }, 5000);

    return () => {
      try {
        clearInterval(pollRef.current);
      } catch {
      }
    };
  }, []);

  const visibleTrips = useMemo(() => {
    const rows = trips ?? [];

    if (activeFilter === "all") return rows;

    if (activeFilter === "problem") {
      return rows.filter((r) => {
        const code = bookingCode(r);
        return stuckTripIds.has(code) || truthy(r?.is_stuck) || truthy(r?.stuck);
      });
    }

    return rows.filter((r) => statusEff(r) === activeFilter);
  }, [trips, activeFilter, stuckTripIds]);

  const selectedTrip = useMemo(() => {
    return (
      visibleTrips.find((t: any) => bookingCode(t) === selectedTripId) ??
      visibleTrips[0] ??
      null
    );
  }, [visibleTrips, selectedTripId]);

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

  const suggestionTrip = useMemo(() => normalizeTripForSuggestions(selectedTrip), [selectedTrip]);
  const suggestionDrivers = useMemo(() => normalizeDriversForSuggestions(drivers), [drivers]);
  const zoneStats = useMemo(() => ({} as Record<string, { util: number; status: string }>), []);
  const assignedDriverId = s(selectedTrip?.assigned_driver_id ?? selectedTrip?.driver_id).trim() || null;

  const canAssign = useMemo(() => {
    const st = statusEff(selectedTrip);
    return st === "dispatch" || st === "requested" || st === "assigned" || !st;
  }, [selectedTrip]);

  const lockReason = canAssign ? undefined : "Trip is no longer in an assignable state.";

  const allDriverTowns = useMemo(() => {
    const set = new Set<string>();
    for (const d of drivers) {
      const t = driverTown(d);
      if (t) set.add(t);
    }
    return ["All", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [drivers]);

  const filteredDrivers = useMemo(() => {
    const rows = [...(drivers ?? [])]
      .filter((d) => filterDriverByTown(d, driverTownFilter))
      .filter((d) => filterDriverBySearch(d, driverSearch));

    if (driverStatusFilter !== "all") {
      return rows.filter((d) => driverStatusBucket(d) === driverStatusFilter).sort(compareDrivers);
    }

    return rows.sort(compareDrivers);
  }, [drivers, driverTownFilter, driverStatusFilter, driverSearch]);

  const selectedDriver = useMemo(() => {
    return (
      filteredDrivers.find((d) => String(d?.driver_id ?? d?.id ?? "") === selectedDriverId) ??
      filteredDrivers[0] ??
      null
    );
  }, [filteredDrivers, selectedDriverId]);

  const driverKPIs = useMemo(() => kpiCounts(drivers), [drivers]);

  const driverTabTrips = useMemo(() => {
    const activeCode = s(selectedDriver?.active_booking_code).trim();
    const activeId = s(selectedDriver?.active_booking_id).trim();
    if (!activeCode && !activeId) return [] as any[];
    return (trips ?? []).filter((t: any) => {
      const code = s(t?.booking_code).trim();
      const id = s(t?.id).trim();
      return (activeCode && code === activeCode) || (activeId && id === activeId);
    });
  }, [selectedDriver, trips]);

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

      <div className="flex flex-wrap gap-2">
        <button
          className={
            "rounded-full border px-3 py-1 text-xs " +
            (mainTab === "trips" ? "bg-black text-white" : "bg-white hover:bg-gray-50")
          }
          onClick={() => setMainTab("trips")}
        >
          Trips
        </button>

        <button
          className={
            "rounded-full border px-3 py-1 text-xs " +
            (mainTab === "drivers" ? "bg-black text-white" : "bg-white hover:bg-gray-50")
          }
          onClick={() => setMainTab("drivers")}
        >
          Drivers
        </button>
      </div>

      {mainTab === "trips" ? (
        <>
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
              const count = summary[k] ?? 0;
              return (
                <button
                  key={k}
                  className={
                    "rounded-full border px-3 py-1 text-xs " +
                    (isOn ? "bg-black text-white" : "bg-white hover:bg-gray-50")
                  }
                  onClick={() => setActiveFilter(k)}
                  title={`${label} (${count})`}
                >
                  {label} <span className={isOn ? "text-white/80" : "text-gray-500"}>({count})</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
            <div>Trips: {visibleTrips.length}</div>
            <div>Fleet: {fleetCount}</div>
            <div className="truncate">DriversDebug: {driversDebug}</div>
            <div className="truncate">LastAction: {lastAction}</div>
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
                      {visibleTrips.map((t: any) => {
                        const code = bookingCode(t);
                        const st = statusEff(t);
                        const isSel = selectedTripId === code;
                        const isProb = stuckTripIds.has(code) || truthy(t?.is_stuck) || truthy(t?.stuck);

                        return (
                          <div
                            key={code || t?.id || Math.random()}
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
                    trip={suggestionTrip as any}
                    drivers={suggestionDrivers as any}
                    zoneStats={zoneStats}
                    onAssign={handleAssign}
                    assignedDriverId={assignedDriverId}
                    assigningDriverId={assigningDriverId}
                    canAssign={canAssign}
                    lockReason={lockReason}
                  />
                </div>
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="overflow-hidden rounded-lg border">
                <LiveTripsMap
                  trips={visibleTrips as any}
                  selectedTripId={selectedTripId}
                  stuckTripIds={stuckTripIds as any}
                  drivers={drivers as any}
                />
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <div className="rounded-lg border bg-white p-3">
              <div className="text-[11px] text-gray-500">Online eligible</div>
              <div className="mt-1 text-lg font-semibold">{driverKPIs.online_eligible}</div>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <div className="text-[11px] text-gray-500">Assigned</div>
              <div className="mt-1 text-lg font-semibold">{driverKPIs.assigned}</div>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <div className="text-[11px] text-gray-500">On trip</div>
              <div className="mt-1 text-lg font-semibold">{driverKPIs.on_trip}</div>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <div className="text-[11px] text-gray-500">Stale</div>
              <div className="mt-1 text-lg font-semibold">{driverKPIs.stale}</div>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <div className="text-[11px] text-gray-500">Offline</div>
              <div className="mt-1 text-lg font-semibold">{driverKPIs.offline}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <select
              className="rounded border px-3 py-2 text-sm"
              value={driverTownFilter}
              onChange={(e) => setDriverTownFilter(e.target.value)}
            >
              {allDriverTowns.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            <select
              className="rounded border px-3 py-2 text-sm"
              value={driverStatusFilter}
              onChange={(e) => setDriverStatusFilter(e.target.value as DriverFilterKey)}
            >
              <option value="all">All statuses</option>
              <option value="online_eligible">Online eligible</option>
              <option value="assigned">Assigned</option>
              <option value="on_trip">On trip</option>
              <option value="stale">Stale</option>
              <option value="offline">Offline</option>
            </select>

            <input
              className="min-w-[240px] flex-1 rounded border px-3 py-2 text-sm"
              placeholder="Search driver, UUID, booking code"
              value={driverSearch}
              onChange={(e) => setDriverSearch(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <div className="xl:col-span-1">
              <div className="rounded-lg border bg-white">
                <div className="border-b p-2 text-sm font-semibold">
                  Drivers ({filteredDrivers.length})
                </div>

                <div className="max-h-[72vh] overflow-auto">
                  {filteredDrivers.length === 0 ? (
                    <div className="p-3 text-sm text-gray-500">No drivers for this filter.</div>
                  ) : (
                    <div className="divide-y">
                      {filteredDrivers.map((d) => {
                        const id = s(d?.driver_id ?? d?.id);
                        const isSel = id === selectedDriverId;
                        const bucket = driverStatusBucket(d);
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setSelectedDriverId(id)}
                            className={"block w-full p-3 text-left " + (isSel ? "bg-gray-50" : "bg-white")}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{driverDisplayName(d)}</div>
                                <div className="truncate text-[11px] text-gray-500">{id}</div>
                              </div>
                              <div className="rounded-full border px-2 py-0.5 text-[11px]">
                                {bucket.replace("_", " ")}
                              </div>
                            </div>

                            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600">
                              <div className="truncate">Town: {driverTown(d) || "-"}</div>
                              <div className="truncate">Last seen: {formatAgo(n(d?.age_seconds))}</div>
                              <div className="truncate">Raw: {s(d?.status) || "-"}</div>
                              <div className="truncate">Effective: {s(d?.effective_status) || "-"}</div>
                              <div className="truncate">Completed: {s(d?.completed_trips_count ?? 0)}</div>
                              <div className="truncate">Cancelled: {s(d?.cancelled_trips_count ?? 0)}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="xl:col-span-2">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-lg border bg-white p-4">
                  <div className="text-sm font-semibold">Driver details</div>

                  {!selectedDriver ? (
                    <div className="mt-3 text-sm text-gray-500">Select a driver.</div>
                  ) : (
                    <div className="mt-3 space-y-3 text-sm">
                      <div>
                        <div className="text-lg font-semibold">{driverDisplayName(selectedDriver)}</div>
                        <div className="font-mono text-xs text-gray-500">
                          {s(selectedDriver?.driver_id ?? selectedDriver?.id)}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-gray-500">Town</div>
                          <div>{driverTown(selectedDriver) || "-"}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Assign eligible</div>
                          <div>{truthy(selectedDriver?.assign_eligible) ? "Yes" : "No"}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Raw status</div>
                          <div>{s(selectedDriver?.status) || "-"}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Effective status</div>
                          <div>{s(selectedDriver?.effective_status) || "-"}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Last seen</div>
                          <div>{formatAgo(n(selectedDriver?.age_seconds))}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Last ping PH</div>
                          <div>{s(selectedDriver?.updated_at_ph) || formatPHTime(selectedDriver?.updated_at)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Completed trips</div>
                          <div>{s(selectedDriver?.completed_trips_count ?? 0)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Cancelled trips</div>
                          <div>{s(selectedDriver?.cancelled_trips_count ?? 0)}</div>
                        </div>
                      </div>

                      <div className="rounded border bg-gray-50 p-3">
                        <div className="text-xs font-semibold text-gray-700">Current dispatch context</div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <div className="text-xs text-gray-500">Active booking code</div>
                            <div>{s(selectedDriver?.active_booking_code) || "-"}</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500">Active booking status</div>
                            <div>{s(selectedDriver?.active_booking_status) || "-"}</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500">Booking town</div>
                            <div>{s(selectedDriver?.active_booking_town) || "-"}</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500">Booking updated</div>
                            <div>{formatPHTime(selectedDriver?.active_booking_updated_at)}</div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded border bg-amber-50 p-3 text-xs text-amber-800">
                        Online session duration is not shown here because the current backend tracks heartbeat freshness, not true online-session start history.
                      </div>
                    </div>
                  )}
                </div>

                <div className="overflow-hidden rounded-lg border">
                  <LiveTripsMap
                    trips={driverTabTrips as any}
                    selectedTripId={selectedTripId}
                    stuckTripIds={stuckTripIds as any}
                    drivers={filteredDrivers as any}
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}