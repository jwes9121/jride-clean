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
 * - Auto-select first trip in current filtered set
 * - Keeps UI reactive after status updates
 */

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
  zone?: string | null; // town/zone name
  town?: string | null;
  driver_id?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type DriverRow = {
  driver_id?: string | null;
  name?: string | null;
  phone?: string | null;
  town?: string | null;
  status?: string | null;
  lat?: number | null;
  lng?: number | null;
  updated_at?: string | null;
};

type PageData = {
  zones?: ZoneRow[];
  trips?: TripRow[];
  bookings?: TripRow[];
  data?: TripRow[];
  driverWalletBalances?: any;
  vendorWalletBalances?: any;
  [k: string]: any;
};

const STUCK_THRESHOLDS_MIN = {
  on_the_way: 15,
  on_trip: 25,
};

function normStatus(s?: any) {
  return String(s || "").trim().toLowerCase();
}

function normTripId(t: TripRow): string {
  return String(t.uuid || t.id || t.booking_code || "");
}

function applyTripStatusToTrips(
  prev: any[],
  bookingCode: string | null,
  bookingId: string | null,
  nextStatus: string
) {
  const code = String(bookingCode || "").trim();
  const id = String(bookingId || "").trim();

  return (prev || []).map((t: any) => {
    const tId = String(t?.id || t?.uuid || "").trim();
    const tCode = String(t?.booking_code || t?.bookingCode || "").trim();

    const match =
      (!!id && tId && tId === id) ||
      (!!code && tCode && tCode === code) ||
      (!!code && tId && tId === code); // sometimes bookingCode is used as id

    return match ? { ...t, status: nextStatus } : t;
  });
}
function safeArray<T>(v: any): T[] {
  if (!v) return [];
  if (Array.isArray(v)) return v as T[];
  return [];
}

function parseTripsFromPageData(j: any): TripRow[] {
  if (!j) return [];
  // common shapes
  const candidates = [
    j.trips,
    j.bookings,
    j.data,
    j["0"],
    Array.isArray(j) ? j : null,
  ];
  for (const c of candidates) {
    const arr = safeArray<TripRow>(c);
    if (arr.length) return arr;
  }
  return [];
}

function minutesSince(iso?: string | null): number {
  if (!iso) return 999999;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 999999;
  const now = Date.now();
  return Math.floor((now - t) / 60000);
}

function isActiveTripStatus(s: string) {
  return ["pending", "assigned", "on_the_way", "on_trip"].includes(s);
}

function isCompletedStatus(s: string) {
  return ["completed", "cancelled"].includes(s);
}

function computeIsProblem(t: TripRow): boolean {
  const s = normStatus(t.status);
  const mins = minutesSince(t.updated_at || t.created_at || null);

  const isStuck =
    (s === "on_the_way" && mins >= STUCK_THRESHOLDS_MIN.on_the_way) ||
    (s === "on_trip" && mins >= STUCK_THRESHOLDS_MIN.on_trip);

  // also treat "missing coords" as problem for active trips
  const hasPickup = Number.isFinite(t.pickup_lat as any) && Number.isFinite(t.pickup_lng as any);
  const hasDropoff = Number.isFinite(t.dropoff_lat as any) && Number.isFinite(t.dropoff_lng as any);
  const missingCoords = isActiveTripStatus(s) && (!hasPickup || !hasDropoff);

  return isStuck || missingCoords;
}

type FilterKey =
  | "dispatch" // pending + assigned + on_the_way
  | "pending"
  | "assigned"
  | "on_the_way"
  | "on_trip"
  | "completed"
  | "cancelled"
  | "problem";

export default function LiveTripsClient() {
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [allTrips, setAllTrips] = useState<TripRow[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  const [tripFilter, setTripFilter] = useState<FilterKey>("dispatch");
  const [lastAction, setLastAction] = useState<string>("");

  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [driversDebug, setDriversDebug] = useState<string>("not loaded yet");

  const [manualDriverId, setManualDriverId] = useState<string>("");

  const tableRef = useRef<HTMLDivElement | null>(null);

  async function loadPage() {
    const r = await fetch(`/api/admin/livetrips/page-data?debug=1&t=${Date.now()}`, { cache: "no-store" });
    const j: PageData = await r.json().catch(() => ({} as any));

    const z = safeArray<ZoneRow>(j.zones);
    const trips = parseTripsFromPageData(j);

    // normalize key fields so UI doesn't break
    const normalized = trips.map((t) => ({
      ...t,
      booking_code: t.booking_code ?? (t as any).bookingCode ?? null,
      pickup_label: t.pickup_label ?? (t as any).from_label ?? (t as any).fromLabel ?? null,
      dropoff_label: t.dropoff_label ?? (t as any).to_label ?? (t as any).toLabel ?? null,
      zone: t.zone ?? (t as any).town ?? (t as any).zone_name ?? null,
      status: t.status ?? "pending",
    }));

    setZones(z);
    setAllTrips(normalized);

    // keep selectedTripId valid
    const ids = new Set(normalized.map(normTripId).filter(Boolean));
    if (selectedTripId && !ids.has(selectedTripId)) {
      setSelectedTripId(null);
    }
  }

  async function loadDrivers() {
    // We keep this conservative (won't break if endpoint differs).
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

        const arr =
          safeArray<DriverRow>(j.drivers) ||
          safeArray<DriverRow>(j.data) ||
          safeArray<DriverRow>(j["0"]) ||
          (Array.isArray(j) ? (j as DriverRow[]) : []);

        if (Array.isArray(arr) && arr.length) {
          setDrivers(arr);
          setDriversDebug(`loaded from ${url} (${arr.length})`);
          return;
        }
      } catch {
        // try next endpoint
      }
    }

    setDrivers([]);
    setDriversDebug("No drivers loaded from known endpoints (check RLS / endpoint path).");
  }

  useEffect(() => {
    // initial load
    loadPage().catch((e) => setLastAction("Trips load failed: " + (e?.message ?? "unknown")));
    loadDrivers().catch((e) => setDriversDebug("Drivers load failed: " + (e?.message ?? "unknown")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh (keeps counts accurate)
  useEffect(() => {
    const t = setInterval(() => {
      loadPage().catch(() => {});
      loadDrivers().catch(() => {});
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Problem/stuck detection set
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
      pending: 0,
      assigned: 0,
      on_the_way: 0,
      on_trip: 0,
      completed: 0,
      cancelled: 0,
      problem: 0,
    };
    for (const t of allTrips) {
      const s = normStatus(t.status);
      if (s === "pending") c.pending++;
      if (s === "assigned") c.assigned++;
      if (s === "on_the_way") c.on_the_way++;
      if (s === "on_trip") c.on_trip++;
      if (s === "completed") c.completed++;
      if (s === "cancelled") c.cancelled++;
      if (["pending", "assigned", "on_the_way"].includes(s)) c.dispatch++;
      if (computeIsProblem(t)) c.problem++;
    }
    return c;
  }, [allTrips]);

  const visibleTrips = useMemo(() => {
    const f = tripFilter;

    let out: TripRow[] = [];
    if (f === "dispatch") {
      out = allTrips.filter((t) => ["pending", "assigned", "on_the_way"].includes(normStatus(t.status)));
    } else if (f === "problem") {
      out = allTrips.filter((t) => stuckTripIds.has(normTripId(t)));
    } else {
      out = allTrips.filter((t) => normStatus(t.status) === f);
    }

    // stable ordering: newest updated first
    out.sort((a, b) => {
      const ta = new Date(a.updated_at || a.created_at || 0 as any).getTime() || 0;
      const tb = new Date(b.updated_at || b.created_at || 0 as any).getTime() || 0;
      return tb - ta;
    });

    // Ensure selection is inside visible set; if not, select first
    if (out.length) {
      const ids = new Set(out.map(normTripId));
      if (!selectedTripId || !ids.has(selectedTripId)) {
        setSelectedTripId(normTripId(out[0]));
      }
    } else {
      setSelectedTripId(null);
    }

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTrips, tripFilter, stuckTripIds]);

  const selectedTrip = useMemo(() => {
    if (!selectedTripId) return null;
    return allTrips.find((t) => normTripId(t) === selectedTripId) || null;
  }, [allTrips, selectedTripId]);

  function pillClass(active: boolean) {
    return [
      "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm",
      active ? "bg-black text-white border-black" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50",
    ].join(" ");
  }

  function setFilterAndFocus(f: FilterKey) {
    setTripFilter(f);

    // after filter changes, scroll list into view (dispatcher-friendly)
    setTimeout(() => {
      if (tableRef.current) {
        tableRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
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
    if (!bookingCode || !driverId) return;
    setLastAction("Assigning...");
    await postJson("/api/dispatch/assign", { bookingCode, driverId });
    setLastAction("Assigned");
    await loadPage();

// Re-apply after refresh so stale page-data cannot revert the UI
try {
  const apiCode2 = String((json && (json.bookingCode || json.booking_code)) || bookingCode || "").trim();
  const apiId2 = String((json && (json.id || json.uuid)) || "").trim();
  const toStatus2 = String((json && (json.toStatus || json.status)) || status);
  setTrips((prev: any[]) => applyTripStatusToTrips(prev, apiCode2, apiId2, toStatus2));
} catch {}
// Re-apply the last status change AFTER refresh (page-data can lag / be stale)
try {
  const toStatus = String((json && (json.toStatus || json.status)) || status);
  setTrips((prev: any[]) =>
    (prev || []).map((t: any) =>
      String(t?.booking_code || t?.bookingCode || t?.id) === String(bookingCode)
        ? { ...t, status: toStatus }
        : t
    )
  );
} catch {}
  }

  async function updateTripStatus(bookingCode: string, status: string) {
  try {
    // visible confirmation that click fired
    setLastAction(`CLICK status=${status} code=${bookingCode}`);

    // call API and surface errors
    const res = await fetch("/api/dispatch/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingCode, status, source: "livetrips-table", override: true }),
      cache: "no-store",
    });

    const json = await res.json().catch(() => ({} as any));

    if (!res.ok) {
      const msg = (json && (json.message || json.error)) || `Status API failed (${res.status})`;
      setLastAction(`ERROR: ${msg}`);
      return;
    }
    // Optimistic UI update so the left table updates instantly
    const toStatus = String((json && (json.toStatus || json.status)) || status);
    try {
      setTrips((prev: any[]) =>
        (prev || []).map((t: any) =>
          String(t?.booking_code || t?.bookingCode || t?.id) === String(bookingCode)
            ? { ...t, status: toStatus }
            : t
        )
      );
    } catch {}

    // If we are in dispatch view, auto-switch when a trip moves out of it
    try {
      if (tripFilter === "dispatch") {
        if (toStatus === "on_trip") setTripFilter("on_trip");
        else if (toStatus === "completed") setTripFilter("completed");
        else if (toStatus === "cancelled") setTripFilter("cancelled");
      }
    } catch {}


    setLastAction(`OK: status=${status} code=${bookingCode}`);
    // Robust UI update (match by id/uuid/booking_code/bookingCode)
    const apiCode = String((json && (json.bookingCode || json.booking_code)) || bookingCode || "").trim();
    const apiId = String((json && (json.id || json.uuid)) || "").trim();
    const toStatus = String((json && (json.toStatus || json.status)) || status);

    try {
      setTrips((prev: any[]) => applyTripStatusToTrips(prev, apiCode, apiId, toStatus));
    } catch {}

    // force refresh page-data so list reflects the change immediately
    await loadPage();

// Re-apply after refresh so stale page-data cannot revert the UI
try {
  const apiCode2 = String((json && (json.bookingCode || json.booking_code)) || bookingCode || "").trim();
  const apiId2 = String((json && (json.id || json.uuid)) || "").trim();
  const toStatus2 = String((json && (json.toStatus || json.status)) || status);
  setTrips((prev: any[]) => applyTripStatusToTrips(prev, apiCode2, apiId2, toStatus2));
} catch {}
// Re-apply the last status change AFTER refresh (page-data can lag / be stale)
try {
  const toStatus = String((json && (json.toStatus || json.status)) || status);
  setTrips((prev: any[]) =>
    (prev || []).map((t: any) =>
      String(t?.booking_code || t?.bookingCode || t?.id) === String(bookingCode)
        ? { ...t, status: toStatus }
        : t
    )
  );
} catch {}
  } catch (err: any) {
    setLastAction(String(err?.message || err || "Unknown error"));
  }
}

  const showThresholds = `Stuck watcher thresholds: on_the_way ≥ ${STUCK_THRESHOLDS_MIN.on_the_way} min, on_trip ≥ ${STUCK_THRESHOLDS_MIN.on_trip} min`;

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Live Trips</h1>
          <p className="text-sm text-gray-600">Monitor active bookings on the left and follow them on the map on the right.</p>
        </div>
        <div className="text-xs text-gray-600 text-right">
          <div className="font-medium">Stuck watcher thresholds</div>
          <div>on_the_way ≥ {STUCK_THRESHOLDS_MIN.on_the_way} min, on_trip ≥ {STUCK_THRESHOLDS_MIN.on_trip} min</div>
        </div>
      </div>

      {/* Clickable status pills */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={pillClass(tripFilter === "dispatch")} onClick={() => setFilterAndFocus("dispatch")}>
          Dispatch <span className="text-xs opacity-80">{counts.dispatch}</span>
        </button>
        <button className={pillClass(tripFilter === "pending")} onClick={() => setFilterAndFocus("pending")}>
          Pending <span className="text-xs opacity-80">{counts.pending}</span>
        </button>
        <button className={pillClass(tripFilter === "assigned")} onClick={() => setFilterAndFocus("assigned")}>
          Assigned <span className="text-xs opacity-80">{counts.assigned}</span>
        </button>
        <button className={pillClass(tripFilter === "on_the_way")} onClick={() => setFilterAndFocus("on_the_way")}>
          On the way <span className="text-xs opacity-80">{counts.on_the_way}</span>
        </button>
        <button className={pillClass(tripFilter === "on_trip")} onClick={() => setFilterAndFocus("on_trip")}>
          On trip <span className="text-xs opacity-80">{counts.on_trip}</span>
        </button>
        <button className={pillClass(tripFilter === "completed")} onClick={() => setFilterAndFocus("completed")}>
          Completed <span className="text-xs opacity-80">{counts.completed}</span>
        </button>
        <button className={pillClass(tripFilter === "cancelled")} onClick={() => setFilterAndFocus("cancelled")}>
          Cancelled <span className="text-xs opacity-80">{counts.cancelled}</span>
        </button>
        <button
          className={[
            pillClass(tripFilter === "problem"),
            tripFilter === "problem" ? "" : "border-red-300 text-red-700 hover:bg-red-50",
          ].join(" ")}
          onClick={() => setFilterAndFocus("problem")}
          title={showThresholds}
        >
          Problem trips <span className="text-xs opacity-80">{counts.problem}</span>
        </button>

        <div className="ml-auto text-xs text-gray-600 self-center">
          {lastAction ? <span>Last action: {lastAction}</span> : <span>&nbsp;</span>}
        </div>
      </div>

      {/* Zones */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        {zones.map((z) => (
          <div key={z.zone_id} className="rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{z.zone_name}</div>
              <div className="text-xs text-gray-600">{z.status || "—"}</div>
            </div>
            <div className="text-xs text-gray-600">
              Active: {z.active_drivers ?? 0} / Limit: {z.capacity_limit ?? "—"}
            </div>
          </div>
        ))}
      </div>

      {/* Main layout: list + map */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4" ref={tableRef}>
        {/* Left: trips list */}
        <div className="rounded-lg border">
          <div className="p-3 border-b flex items-center justify-between">
            <div className="font-semibold">
              {tripFilter === "dispatch" ? "Dispatch view (Pending + Assigned + On the way)" : "Trips"}
            </div>
            <div className="text-xs text-gray-600">{visibleTrips.length} shown</div>
          </div>

          <div className="overflow-auto" style={{ maxHeight: 520 }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white border-b">
                <tr className="text-left">
                  <th className="p-2">Code</th>
                  <th className="p-2">Passenger</th>
                  <th className="p-2">Pickup</th>
                  <th className="p-2">Dropoff</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Zone</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleTrips.length === 0 ? (
                  <tr>
                    <td className="p-3 text-gray-600" colSpan={7}>
                      No trips in this view.
                    </td>
                  </tr>
                ) : (
                  visibleTrips.map((t) => {
                    const id = normTripId(t);
                    const isSel = selectedTripId === id;
                    const isProblem = stuckTripIds.has(id);
                    const s = normStatus(t.status);

                    return (
                      <tr
                        key={id || Math.random()}
                        className={[
                          "border-b cursor-pointer",
                          isSel ? "bg-blue-50" : "hover:bg-gray-50",
                        ].join(" ")}
                        onClick={() => setSelectedTripId(id)}
                      >
                        <td className="p-2 font-medium">
                          {t.booking_code || "—"}
                          {isProblem ? (
                            <span className="ml-2 inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-700">
                              PROBLEM
                            </span>
                          ) : null}
                        </td>
                        <td className="p-2">{t.passenger_name || "—"}</td>
                        <td className="p-2">{t.pickup_label || "—"}</td>
                        <td className="p-2">{t.dropoff_label || "—"}</td>
                        <td className="p-2">
                          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
                            {s || "—"}
                          </span>
                        </td>
                        <td className="p-2">{t.zone || t.town || "—"}</td>
                        <td className="p-2">
                          {/* Minimal inline status actions */}
                          <div className="flex flex-wrap gap-2 items-center">
                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!t.booking_code) return;
                                console.log("[LiveTrips] CLICK on_the_way", t.booking_code); updateTripStatus(t.booking_code, "on_the_way").catch((err) => setLastAction(String(err?.message || err)));
                              }}
                              disabled={false}
                              title={s !== "assigned" ? "Allowed only when status=assigned" : "Mark on_the_way"}
                            >
                              On the way
                            </button>

                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!t.booking_code) return;
                                console.log("[LiveTrips] CLICK on_trip", t.booking_code); updateTripStatus(t.booking_code, "on_trip").catch((err) => setLastAction(String(err?.message || err)));
                              }}
                              disabled={false}
                              title={s !== "on_the_way" ? "Allowed only when status=on_the_way" : "Start trip"}
                            >
                              Start trip
                            </button>

                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!t.booking_code) return;
                                console.log("[LiveTrips] CLICK completed", t.booking_code); updateTripStatus(t.booking_code, "completed").catch((err) => setLastAction(String(err?.message || err)));
                              }}
                              disabled={false}
                              title={s !== "on_trip" ? "Allowed only when status=on_trip" : "Complete trip"}
                            >
                              Drop off
                            </button>

                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTripId(id);
                                setFilterAndFocus("problem");
                              }}
                              title="Focus Problem trips view"
                            >
                              Find problem
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

          {/* Selection controls & panels */}
          <div className="p-3 border-t">
            <div className="text-xs text-gray-600 mb-2">
              Drivers: {driversDebug}
            </div>

            {/* Keep your existing components (won't break if they handle null gracefully) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <TripWalletPanel trip={selectedTrip as any} />
              <TripLifecycleActions trip={selectedTrip as any} />
            </div>

            <div className="mt-3 rounded border p-3">
              <div className="font-semibold mb-2">Assign driver (manual)</div>
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  className="border rounded px-2 py-1 text-sm min-w-[320px]"
                  value={manualDriverId}
                  onChange={(e) => setManualDriverId(e.target.value)}
                >
                  <option value="">Select driver</option>
                  {drivers.map((d, idx) => {
                    const id = String(d.driver_id || "");
                    const label = `${d.name || "Driver"} ${d.town ? `— ${d.town}` : ""} ${d.status ? `— ${d.status}` : ""}`.trim();
                    return (
                      <option key={id || idx} value={id}>
                        {label}
                      </option>
                    );
                  })}
                </select>

                <button
                  className="rounded bg-black text-white px-3 py-2 text-sm disabled:opacity-50"
                  disabled={!selectedTrip?.booking_code || !manualDriverId}
                  onClick={() => {
                    if (!selectedTrip?.booking_code) return;
                    assignDriver(selectedTrip.booking_code, manualDriverId).catch((err) => setLastAction(String(err?.message || err)));
                  }}
                >
                  Assign
                </button>

                <button
                  className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={() => {
                    loadPage().catch(() => {});
                    loadDrivers().catch(() => {});
                    setLastAction("Refreshed");
                  }}
                >
                  Refresh now
                </button>
              </div>

              <div className="mt-2">
                <SmartAutoAssignSuggestions trip={selectedTrip as any} drivers={drivers as any} />
              </div>
            </div>
          </div>
        </div>

        {/* Right: map */}
        <div className="rounded-lg border overflow-hidden">
          <LiveTripsMap trips={visibleTrips as any} selectedTripId={selectedTripId} stuckTripIds={stuckTripIds as any} />
        </div>
      </div>
    </div>
  );
}









