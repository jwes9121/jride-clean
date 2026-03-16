"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import LiveTripsMap from "./components/LiveTripsMap";
import SmartAutoAssignSuggestions from "./components/SmartAutoAssignSuggestions";
import TripWalletPanel from "./components/TripWalletPanel";
import TripLifecycleActions from "./components/TripLifecycleActions";

type ZoneRow = {
  zone_id: string;
  zone_name: string;
  color_hex?: string | null;
  capacity_limit?: number | null;
  active_drivers?: number | null;
  available_slots?: number | null;
  status?: string | null;
};

type TripRow = {
  id?: string | number | null;
  uuid?: string | null;
  booking_code?: string | null;
  passenger_name?: string | null;
  pickup_label?: string | null;
  dropoff_label?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  status?: string | null;
  zone?: string | null;
  town?: string | null;
  driver_id?: string | null;
  assigned_driver_id?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  driver_status?: string | null;
  toda_name?: string | null;
  zone_id?: string | null;
  wallet_balance?: number | null;
  updated_at?: string | null;
  created_at?: string | null;
  current_offer_driver_id?: string | null;
  current_offer_driver_name?: string | null;
  current_offer_status?: string | null;
  current_offer_rank?: number | null;
  current_offer_expires_at?: string | null;
  current_offer_offered_at?: string | null;
  current_offer_responded_at?: string | null;
  current_offer_response_source?: string | null;
};

type DriverRow = {
  driver_id?: string;
  id?: string;
  lat?: number;
  lng?: number;
  status?: string;
  updated_at?: string;
  last_seen?: string;
  age_seconds?: number;
  assign_eligible?: boolean;
  is_stale?: boolean;
  name?: string;
  phone?: string;
  town?: string;
  home_town?: string;
};

type PageData = {
  zones?: ZoneRow[];
  trips?: TripRow[];
  bookings?: TripRow[];
  data?: TripRow[];
  warnings?: string[];
  debug?: any;
  [k: string]: any;
};

const STUCK_THRESHOLDS_MIN = {
  on_the_way: 15,
  on_trip: 25,
};

type FilterKey =
  | "dispatch"
  | "unassigned"
  | "requested"
  | "assigned"
  | "on_the_way"
  | "on_trip"
  | "completed"
  | "cancelled"
  | "problem";

function normStatus(s?: any) {
  return String(s || "").trim().toLowerCase();
}

function normTripId(t: TripRow): string {
  return String(t.uuid || t.id || t.booking_code || "");
}

function safeArray<T>(v: any): T[] {
  if (!v) return [];
  if (Array.isArray(v)) return v as T[];
  return [];
}

function parseTripsFromPageData(j: any): TripRow[] {
  if (!j) return [];
  const candidates = [j.trips, j.bookings, j.data, j["0"], Array.isArray(j) ? j : null];
  for (const c of candidates) {
    const arr = safeArray<TripRow>(c);
    if (arr.length) return arr;
  }
  return [];
}

function parseDriversFromPayload(j: any): DriverRow[] {
  if (!j) return [];
  const candidates = [j.drivers, j.data, j["0"], Array.isArray(j) ? j : null];
  for (const c of candidates) {
    const arr = safeArray<DriverRow>(c);
    if (arr.length) return arr;
  }
  return [];
}

function minutesSince(iso?: string | null): number {
  if (!iso) return 999999;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 999999;
  return Math.floor((Date.now() - t) / 60000);
}

function isActiveTripStatus(s: string) {
  return ["requested", "assigned", "on_the_way", "on_trip"].includes(s);
}

function computeIsProblem(t: TripRow): boolean {
  const s = normStatus(t.status);
  const mins = minutesSince(t.updated_at || t.created_at || null);
  const isStuck =
    (s === "on_the_way" && mins >= STUCK_THRESHOLDS_MIN.on_the_way) ||
    (s === "on_trip" && mins >= STUCK_THRESHOLDS_MIN.on_trip);

  const hasPickup = Number.isFinite(t.pickup_lat as any) && Number.isFinite(t.pickup_lng as any);
  const hasDropoff = Number.isFinite(t.dropoff_lat as any) && Number.isFinite(t.dropoff_lng as any);
  const missingCoords = isActiveTripStatus(s) && (!hasPickup || !hasDropoff);

  return isStuck || missingCoords;
}

function formatWaiting(createdAt?: string | null) {
  if (!createdAt) return "--";
  const age = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
  if (age < 60) return `${age}s`;
  if (age < 3600) return `${Math.floor(age / 60)}m`;
  return `${Math.floor(age / 3600)}h`;
}

function waitingTone(createdAt?: string | null) {
  if (!createdAt) return "text-gray-600";
  const age = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
  if (age >= 180) return "text-red-700 font-semibold";
  if (age >= 60) return "text-amber-700 font-semibold";
  return "text-gray-700";
}

function formatSeenAgo(ageSeconds?: number | null) {
  if (ageSeconds === null || ageSeconds === undefined || !Number.isFinite(ageSeconds)) return "--";
  if (ageSeconds < 60) return `${Math.floor(ageSeconds)}s`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m`;
  return `${Math.floor(ageSeconds / 3600)}h`;
}

function formatPht(iso?: string | null) {
  if (!iso) return "--";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "--";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d);
}

function offerBadgeClass(status?: string | null) {
  const s = normStatus(status);
  if (s === "accepted") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (s === "offered") return "border-blue-300 bg-blue-50 text-blue-700";
  if (s === "expired" || s === "rejected" || s === "cancelled" || s === "skipped") {
    return "border-red-300 bg-red-50 text-red-700";
  }
  return "border-gray-300 bg-gray-50 text-gray-700";
}

function isUnassigned(t: TripRow) {
  return normStatus(t.status) === "requested" && !String(t.assigned_driver_id || t.driver_id || "").trim();
}

export default function LiveTripsClient() {
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [allTrips, setAllTrips] = useState<TripRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [tripFilter, setTripFilter] = useState<FilterKey>("unassigned");
  const [lastAction, setLastAction] = useState<string>("");
  const [driversDebug, setDriversDebug] = useState<string>("not loaded yet");
  const [manualDriverId, setManualDriverId] = useState<string>("");
  const [assigningDriverId, setAssigningDriverId] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);

  async function loadPage() {
    const r = await fetch("/api/admin/livetrips/page-data?debug=1", { cache: "no-store" });
    const j: PageData = await r.json().catch(() => ({} as any));

    const trips = parseTripsFromPageData(j).map((t) => ({
      ...t,
      booking_code: t.booking_code ?? (t as any).bookingCode ?? null,
      pickup_label: t.pickup_label ?? (t as any).from_label ?? (t as any).fromLabel ?? null,
      dropoff_label: t.dropoff_label ?? (t as any).to_label ?? (t as any).toLabel ?? null,
      zone: t.zone ?? (t as any).town ?? (t as any).zone_name ?? null,
      status: t.status ?? "requested",
    }));

    setZones(safeArray<ZoneRow>(j.zones));
    setAllTrips(trips);
  }

  async function loadDrivers() {
    const endpoints = [
      "/api/admin/driver-locations",
      "/api/admin/driver_locations",
      "/api/admin/drivers",
      "/api/driver-locations",
      "/api/driver_locations",
    ];

    for (const url of endpoints) {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) continue;
        const j = await r.json().catch(() => ({} as any));
        const arr = parseDriversFromPayload(j);
        if (arr.length) {
          setDrivers(arr);
          setDriversDebug(`loaded from ${url} (${arr.length})`);
          return;
        }
      } catch {
        // try next endpoint
      }
    }

    setDrivers([]);
    setDriversDebug("No drivers loaded from known endpoints.");
  }

  async function refreshAll() {
    await Promise.all([loadPage(), loadDrivers()]);
  }

  useEffect(() => {
    refreshAll().catch((e) => setLastAction(String(e?.message || e)));
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      refreshAll().catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const stuckTripIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of allTrips) {
      if (computeIsProblem(t)) {
        const id = normTripId(t);
        if (id) s.add(id);
      }
    }
    return s;
  }, [allTrips]);

  const counts = useMemo(() => {
    const c = {
      dispatch: 0,
      unassigned: 0,
      requested: 0,
      assigned: 0,
      on_the_way: 0,
      on_trip: 0,
      completed: 0,
      cancelled: 0,
      problem: 0,
    };

    for (const t of allTrips) {
      const s = normStatus(t.status);
      if (s === "requested") c.requested++;
      if (isUnassigned(t)) c.unassigned++;
      if (s === "assigned") c.assigned++;
      if (s === "on_the_way") c.on_the_way++;
      if (s === "on_trip") c.on_trip++;
      if (s === "completed") c.completed++;
      if (s === "cancelled") c.cancelled++;
      if (isUnassigned(t) || s === "assigned" || s === "on_the_way") c.dispatch++;
      if (computeIsProblem(t)) c.problem++;
    }
    return c;
  }, [allTrips]);

  const visibleTrips = useMemo(() => {
    let out: TripRow[] = [];
    if (tripFilter === "dispatch") {
      out = allTrips.filter((t) => isUnassigned(t) || ["assigned", "on_the_way"].includes(normStatus(t.status)));
    } else if (tripFilter === "unassigned") {
      out = allTrips.filter((t) => isUnassigned(t));
    } else if (tripFilter === "problem") {
      out = allTrips.filter((t) => stuckTripIds.has(normTripId(t)));
    } else {
      out = allTrips.filter((t) => normStatus(t.status) === tripFilter);
    }

    return [...out].sort((a, b) => {
      const ta = new Date(a.updated_at || a.created_at || 0 as any).getTime() || 0;
      const tb = new Date(b.updated_at || b.created_at || 0 as any).getTime() || 0;
      return tb - ta;
    });
  }, [allTrips, tripFilter, stuckTripIds]);

  useEffect(() => {
    const ids = new Set(visibleTrips.map(normTripId).filter(Boolean));
    if (!visibleTrips.length) {
      setSelectedTripId(null);
      return;
    }
    if (!selectedTripId || !ids.has(selectedTripId)) {
      setSelectedTripId(normTripId(visibleTrips[0]));
    }
  }, [visibleTrips, selectedTripId]);

  const selectedTrip = useMemo(() => {
    if (!selectedTripId) return null;
    return allTrips.find((t) => normTripId(t) === selectedTripId) || null;
  }, [allTrips, selectedTripId]);

  const driverRows = useMemo(() => {
    return [...drivers]
      .map((d) => {
        const driverId = String(d.driver_id || d.id || "");
        const age = typeof d.age_seconds === "number"
          ? d.age_seconds
          : d.updated_at || d.last_seen
          ? Math.max(0, Math.floor((Date.now() - new Date(String(d.updated_at || d.last_seen)).getTime()) / 1000))
          : null;
        const lastPing = (d.updated_at || d.last_seen || null) as string | null;
        const currentOfferTrip = allTrips.find((t) => normStatus(t.current_offer_status) === "offered" && String(t.current_offer_driver_id || "") === driverId);
        return {
          ...d,
          driver_id: driverId,
          age_seconds: age ?? undefined,
          updated_at: lastPing || undefined,
          current_offer_booking: currentOfferTrip?.booking_code || null,
          current_offer_rank: currentOfferTrip?.current_offer_rank ?? null,
          current_offer_expiry: currentOfferTrip?.current_offer_expires_at ?? null,
        };
      })
      .sort((a, b) => {
        const aa = typeof a.age_seconds === "number" ? a.age_seconds : 999999;
        const bb = typeof b.age_seconds === "number" ? b.age_seconds : 999999;
        return aa - bb;
      });
  }, [drivers, allTrips]);

  function pillClass(active: boolean) {
    return [
      "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm",
      active ? "bg-black text-white border-black" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50",
    ].join(" ");
  }

  function setFilterAndFocus(f: FilterKey) {
    setTripFilter(f);
    setTimeout(() => {
      tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  async function postJson(url: string, body: any) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j && (j.error || j.message)) || "REQUEST_FAILED";
      throw new Error(msg);
    }
    return j;
  }

  async function assignDriver(bookingCode: string, driverId: string) {
    setAssigningDriverId(driverId);
    setLastAction(`Assigning ${bookingCode}...`);
    try {
      await postJson("/api/dispatch/assign", { bookingCode, driverId });
      setLastAction(`Assigned ${bookingCode}`);
      await refreshAll();
    } finally {
      setAssigningDriverId(null);
    }
  }

  async function sendOffer(bookingCode: string) {
    setLastAction(`Sending offer for ${bookingCode}...`);
    await postJson("/api/dispatch/offer", {
      bookingCode,
      timeoutSeconds: 8,
      source: "livetrips_manual",
    });
    setLastAction(`Offer sent for ${bookingCode}`);
    await refreshAll();
  }

  async function updateTripStatus(bookingCode: string, status: string) {
    setLastAction(`Updating ${bookingCode} -> ${status}...`);
    await postJson("/api/dispatch/status", { bookingCode, status });
    setLastAction(`Status updated for ${bookingCode}`);
    await refreshAll();
  }

  const suggestionTrip = selectedTrip
    ? {
        id: String(selectedTrip.id || selectedTrip.booking_code || ""),
        pickupLat: Number(selectedTrip.pickup_lat || 0),
        pickupLng: Number(selectedTrip.pickup_lng || 0),
        zone: String(selectedTrip.zone || selectedTrip.town || ""),
        tripType: "ride",
      }
    : null;

  const suggestionDrivers = driverRows
    .filter((d) => Number.isFinite(d.lat as any) && Number.isFinite(d.lng as any))
    .map((d) => ({
      id: String(d.driver_id || ""),
      name: String(d.name || d.driver_id || "Driver"),
      lat: Number(d.lat || 0),
      lng: Number(d.lng || 0),
      zone: String(d.town || ""),
      homeTown: String(d.home_town || d.town || ""),
      status: String(d.status || ""),
    }));

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Live Trips</h1>
          <p className="text-sm text-gray-600">Unassigned queue, dispatch offer visibility, and normalized driver freshness.</p>
        </div>
        <div className="text-xs text-gray-600 text-right">
          <div className="font-medium">Stuck watcher thresholds</div>
          <div>on_the_way {">="} {STUCK_THRESHOLDS_MIN.on_the_way} min, on_trip {">="} {STUCK_THRESHOLDS_MIN.on_trip} min</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button className={pillClass(tripFilter === "dispatch")} onClick={() => setFilterAndFocus("dispatch")}>Dispatch <span className="text-xs opacity-80">{counts.dispatch}</span></button>
        <button className={pillClass(tripFilter === "unassigned")} onClick={() => setFilterAndFocus("unassigned")}>Unassigned <span className="text-xs opacity-80">{counts.unassigned}</span></button>
        <button className={pillClass(tripFilter === "requested")} onClick={() => setFilterAndFocus("requested")}>Requested <span className="text-xs opacity-80">{counts.requested}</span></button>
        <button className={pillClass(tripFilter === "assigned")} onClick={() => setFilterAndFocus("assigned")}>Assigned <span className="text-xs opacity-80">{counts.assigned}</span></button>
        <button className={pillClass(tripFilter === "on_the_way")} onClick={() => setFilterAndFocus("on_the_way")}>On the way <span className="text-xs opacity-80">{counts.on_the_way}</span></button>
        <button className={pillClass(tripFilter === "on_trip")} onClick={() => setFilterAndFocus("on_trip")}>On trip <span className="text-xs opacity-80">{counts.on_trip}</span></button>
        <button className={pillClass(tripFilter === "completed")} onClick={() => setFilterAndFocus("completed")}>Completed <span className="text-xs opacity-80">{counts.completed}</span></button>
        <button className={pillClass(tripFilter === "cancelled")} onClick={() => setFilterAndFocus("cancelled")}>Cancelled <span className="text-xs opacity-80">{counts.cancelled}</span></button>
        <button className={[pillClass(tripFilter === "problem"), tripFilter === "problem" ? "" : "border-red-300 text-red-700 hover:bg-red-50"].join(" ")} onClick={() => setFilterAndFocus("problem")}>Problem <span className="text-xs opacity-80">{counts.problem}</span></button>
        <div className="ml-auto flex items-center gap-3 text-xs text-gray-600 self-center">
          <span>{lastAction || "Ready"}</span>
          <button className="rounded border px-3 py-1.5 text-xs hover:bg-gray-50" onClick={() => refreshAll().then(() => setLastAction("Refreshed"))}>Refresh now</button>
        </div>
      </div>

      {!!zones.length && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          {zones.map((z) => (
            <div key={z.zone_id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{z.zone_name}</div>
                <div className="text-xs text-gray-600">{z.status || "-"}</div>
              </div>
              <div className="text-xs text-gray-600">Active: {z.active_drivers ?? 0} / Limit: {z.capacity_limit ?? "-"}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4" ref={tableRef}>
        <div className="rounded-lg border overflow-hidden">
          <div className="p-3 border-b flex items-center justify-between">
            <div className="font-semibold">{tripFilter === "unassigned" ? "Unassigned queue" : tripFilter === "dispatch" ? "Dispatch view" : "Trips"}</div>
            <div className="text-xs text-gray-600">{visibleTrips.length} shown</div>
          </div>

          <div className="overflow-auto" style={{ maxHeight: 560 }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white border-b">
                <tr className="text-left">
                  <th className="p-2">Code</th>
                  <th className="p-2">Passenger</th>
                  <th className="p-2">Pickup</th>
                  <th className="p-2">Waiting</th>
                  <th className="p-2">Offer</th>
                  <th className="p-2">Driver</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Zone</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!visibleTrips.length ? (
                  <tr>
                    <td className="p-3 text-gray-600" colSpan={9}>No trips in this view.</td>
                  </tr>
                ) : (
                  visibleTrips.map((t) => {
                    const id = normTripId(t);
                    const s = normStatus(t.status);
                    const isSel = selectedTripId === id;
                    const problem = stuckTripIds.has(id);
                    const offerStatus = t.current_offer_status || (isUnassigned(t) ? "waiting" : null);
                    const offerDriver = t.current_offer_driver_name || t.current_offer_driver_id || "--";
                    return (
                      <tr key={id} className={["border-b cursor-pointer", isSel ? "bg-blue-50" : "hover:bg-gray-50"].join(" ")} onClick={() => setSelectedTripId(id)}>
                        <td className="p-2 font-medium align-top">
                          <div>{t.booking_code || "-"}</div>
                          {problem ? <div className="mt-1 inline-flex rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] text-red-700">PROBLEM</div> : null}
                        </td>
                        <td className="p-2 align-top">{t.passenger_name || "-"}</td>
                        <td className="p-2 align-top">{t.pickup_label || "-"}</td>
                        <td className="p-2 align-top">
                          <span className={waitingTone(t.created_at)}>{formatWaiting(t.created_at)}</span>
                        </td>
                        <td className="p-2 align-top">
                          <div className="space-y-1">
                            <div>
                              <span className={["inline-flex rounded-full border px-2 py-0.5 text-[10px]", offerBadgeClass(offerStatus)].join(" ")}>{offerStatus || "--"}</span>
                            </div>
                            <div className="text-[11px] text-gray-600">{offerDriver}</div>
                            {t.current_offer_rank ? <div className="text-[11px] text-gray-500">Rank #{t.current_offer_rank}</div> : null}
                            {t.current_offer_expires_at ? <div className="text-[11px] text-gray-500">Expires {formatPht(t.current_offer_expires_at)}</div> : null}
                          </div>
                        </td>
                        <td className="p-2 align-top">
                          <div>{t.driver_name || "--"}</div>
                          {t.driver_status ? <div className="text-[11px] text-gray-500">{t.driver_status}</div> : null}
                        </td>
                        <td className="p-2 align-top"><span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">{s || "-"}</span></td>
                        <td className="p-2 align-top">{t.zone || t.town || "-"}</td>
                        <td className="p-2 align-top">
                          <div className="flex flex-wrap gap-2 items-center">
                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!t.booking_code) return;
                                sendOffer(t.booking_code).catch((err) => setLastAction(String(err?.message || err)));
                              }}
                              disabled={!t.booking_code || s === "completed" || s === "cancelled"}
                            >
                              {isUnassigned(t) ? "Send offer" : "Retry offer"}
                            </button>
                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!t.booking_code) return;
                                updateTripStatus(t.booking_code, "on_the_way").catch((err) => setLastAction(String(err?.message || err)));
                              }}
                              disabled={s !== "assigned"}
                            >
                              On the way
                            </button>
                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!t.booking_code) return;
                                updateTripStatus(t.booking_code, "on_trip").catch((err) => setLastAction(String(err?.message || err)));
                              }}
                              disabled={s !== "on_the_way"}
                            >
                              Start trip
                            </button>
                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!t.booking_code) return;
                                updateTripStatus(t.booking_code, "completed").catch((err) => setLastAction(String(err?.message || err)));
                              }}
                              disabled={s !== "on_trip"}
                            >
                              Drop off
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="p-3 border-t space-y-3">
            <div className="text-xs text-gray-600">Drivers: {driversDebug}</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <TripWalletPanel trip={selectedTrip as any} />
              <TripLifecycleActions trip={selectedTrip as any} />
            </div>

            <div className="rounded border p-3">
              <div className="font-semibold mb-2">Assign driver (manual)</div>
              <div className="flex flex-wrap gap-2 items-center">
                <select className="border rounded px-2 py-1 text-sm min-w-[320px]" value={manualDriverId} onChange={(e) => setManualDriverId(e.target.value)}>
                  <option value="">Select driver</option>
                  {driverRows.map((d, idx) => {
                    const id = String(d.driver_id || "");
                    const label = `${d.name || id || "Driver"}${d.town ? ` - ${d.town}` : ""}${d.status ? ` - ${d.status}` : ""}`;
                    return <option key={id || idx} value={id}>{label}</option>;
                  })}
                </select>
                <button
                  className="rounded bg-black text-white px-3 py-2 text-sm disabled:opacity-50"
                  disabled={!selectedTrip?.booking_code || !manualDriverId}
                  onClick={() => {
                    if (!selectedTrip?.booking_code || !manualDriverId) return;
                    assignDriver(selectedTrip.booking_code, manualDriverId).catch((err) => setLastAction(String(err?.message || err)));
                  }}
                >
                  {selectedTrip?.assigned_driver_id || selectedTrip?.driver_id ? "Reassign" : "Assign"}
                </button>
                {selectedTrip?.booking_code ? (
                  <button className="rounded border px-3 py-2 text-sm hover:bg-gray-50" onClick={() => sendOffer(selectedTrip.booking_code!).catch((err) => setLastAction(String(err?.message || err)))}>
                    Send offer
                  </button>
                ) : null}
              </div>
              <div className="mt-3">
                <SmartAutoAssignSuggestions
                  trip={suggestionTrip as any}
                  drivers={suggestionDrivers as any}
                  zoneStats={{}}
                  onAssign={(driverId) => {
                    if (!selectedTrip?.booking_code) return Promise.resolve();
                    return assignDriver(selectedTrip.booking_code, driverId);
                  }}
                  assignedDriverId={String(selectedTrip?.assigned_driver_id || selectedTrip?.driver_id || "") || null}
                  assigningDriverId={assigningDriverId}
                  canAssign={normStatus(selectedTrip?.status) !== "on_trip" && normStatus(selectedTrip?.status) !== "completed"}
                  lockReason={normStatus(selectedTrip?.status) === "on_trip" ? "Trip already started." : normStatus(selectedTrip?.status) === "completed" ? "Trip already completed." : undefined}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border overflow-hidden">
            <LiveTripsMap trips={visibleTrips as any} selectedTripId={selectedTripId} stuckTripIds={stuckTripIds as any} />
          </div>

          <div className="rounded-lg border overflow-hidden">
            <div className="p-3 border-b flex items-center justify-between">
              <div className="font-semibold">Drivers</div>
              <div className="text-xs text-gray-600">{driverRows.length} shown</div>
            </div>
            <div className="overflow-auto" style={{ maxHeight: 360 }}>
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white border-b">
                  <tr className="text-left">
                    <th className="p-2">Driver</th>
                    <th className="p-2">Town</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Last Ping (PHT)</th>
                    <th className="p-2">Seen Ago</th>
                    <th className="p-2">Offer</th>
                  </tr>
                </thead>
                <tbody>
                  {!driverRows.length ? (
                    <tr><td className="p-3 text-gray-600" colSpan={6}>No drivers loaded.</td></tr>
                  ) : (
                    driverRows.map((d, idx) => (
                      <tr key={String(d.driver_id || idx)} className="border-b">
                        <td className="p-2">{d.name || d.driver_id || "-"}</td>
                        <td className="p-2">{d.town || d.home_town || "-"}</td>
                        <td className="p-2">{d.status || "-"}</td>
                        <td className="p-2">{formatPht(d.updated_at || d.last_seen || null)}</td>
                        <td className="p-2">{formatSeenAgo(d.age_seconds)}</td>
                        <td className="p-2 text-[11px] text-gray-600">
                          {d.current_offer_booking ? (
                            <div>
                              <div>{d.current_offer_booking}</div>
                              <div>Rank #{d.current_offer_rank || "--"}</div>
                              <div>{formatPht(d.current_offer_expiry || null)}</div>
                            </div>
                          ) : "--"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
