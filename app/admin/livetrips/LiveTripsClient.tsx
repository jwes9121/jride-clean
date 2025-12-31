"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import LiveTripsMap from "./components/LiveTripsMap";
import SmartAutoAssignSuggestions from "./components/SmartAutoAssignSuggestions";
import TripWalletPanel from "./components/TripWalletPanel";
import TripLifecycleActions from "./components/TripLifecycleActions";

/* -------------------- helpers -------------------- */

function safeText(v: any) {
  if (v == null) return "-";
  const s = String(v);
  return s.replace(/[^\x00-\x7F]/g, "-");
}

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
  [k: string]: any;
};

type FilterKey =
  | "dispatch"
  | "pending"
  | "assigned"
  | "on_the_way"
  | "arrived"
  | "enroute"
  | "on_trip"
  | "completed"
  | "cancelled"
  | "problem";

const JRIDE_LIVETRIPS_EVT = "JRIDE_LIVETRIPS_EVT";

const STUCK_THRESHOLDS_MIN = {
  on_the_way: 15,
  on_trip: 25,
  arrived: 15,
};

function normStatus(s?: any) {
  return String(s || "").trim().toLowerCase();
}

function hasDriver(t: any): boolean {
  const v =
    t?.driver_id ??
    t?.assigned_driver_id ??
    t?.driverId ??
    null;
  return v != null && String(v).length > 0;
}

function effectiveStatus(t: any): string {
  const s = normStatus(t?.status);
  if (s === "assigned" && !hasDriver(t)) return "pending";
  if (s === "requested") return "pending";
  return s;
}

function normTripId(t: TripRow): string {
  return String(t.uuid || t.id || t.booking_code || "");
}

function minutesSince(iso?: string | null): number {
  if (!iso) return 999999;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 999999;
  return Math.floor((Date.now() - t) / 60000);
}

function isActiveTripStatus(s: string) {
  return ["pending","assigned","on_the_way","arrived","enroute","on_trip"].includes(s);
}

function computeProblemReason(t: TripRow): string | null {
  const s = normStatus(t.status);
  const mins = minutesSince(t.updated_at || t.created_at || null);

  if (isActiveTripStatus(s) && (!Number.isFinite(t.pickup_lat as any) || !Number.isFinite(t.dropoff_lat as any))) {
    return "Missing pickup/dropoff coordinates";
  }
  if (s === "assigned" && !hasDriver(t)) return "Assigned but no driver linked";
  if (s === "on_the_way" && mins >= STUCK_THRESHOLDS_MIN.on_the_way) return `On the way stale (${mins}m)`;
  if (s === "arrived" && mins >= STUCK_THRESHOLDS_MIN.arrived) return `Arrived stale (${mins}m)`;
  if (s === "on_trip" && mins >= STUCK_THRESHOLDS_MIN.on_trip) return `On trip stale (${mins}m)`;
  if (s === "enroute" && mins >= STUCK_THRESHOLDS_MIN.arrived) return `Enroute stale (${mins}m)`;
  return null;
}

function computeIsProblem(t: TripRow): boolean {
  return !!computeProblemReason(t);
}

/* -------------------- backend action helper (FIXED POSITION) -------------------- */

async function callLiveTripsAction(
  action: "NUDGE_DRIVER" | "REASSIGN_DRIVER" | "AUTO_ASSIGN",
  t: any
) {
  const booking_code = t?.booking_code ?? t?.bookingCode ?? null;
  const trip_id = t?.id ?? t?.uuid ?? null;

  const res = await fetch("/api/admin/livetrips/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, booking_code, trip_id }),
  });

  const js: any = await res.json().catch(() => ({}));
  if (!res.ok || !js?.ok) {
    throw new Error(js?.message || js?.code || `HTTP ${res.status}`);
  }
  return js;
}

/* ==================== COMPONENT ==================== */

export default function LiveTripsClient() {
  const pendingOverrideRef = useRef<Record<string, number>>({});
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [allTrips, setAllTrips] = useState<TripRow[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [tripFilter, setTripFilter] = useState<FilterKey>("dispatch");
  const [lastAction, setLastAction] = useState<string>("");
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [driversDebug, setDriversDebug] = useState<string>("not loaded yet");
  const [manualDriverId, setManualDriverId] = useState<string>("");

  const tableRef = useRef<HTMLDivElement | null>(null);

  async function postJson(url: string, body: any) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || j?.message || "REQUEST_FAILED");
    return j;
  }

  async function updateTripStatus(bookingCode: string, status: string) {
    if (!bookingCode || !status) return;
    setLastAction("Updating status...");
    await postJson("/api/dispatch/status", { booking_code: bookingCode, bookingCode, status });
    setLastAction("Status updated");
    await loadPage();
  }

  async function forceTripStatus(bookingCode: string, status: string) {
    if (!bookingCode || !status) return;
    setLastAction("Forcing status...");
    await postJson("/api/dispatch/status", { booking_code: bookingCode, bookingCode, status, force: true });
    setLastAction("Force status sent");
    await loadPage();
  }

  async function assignDriver(bookingCode: string, driverId: string) {
    if (!bookingCode || !driverId) return;
    setLastAction("Assigning...");
    await postJson("/api/dispatch/assign", { booking_code: bookingCode, bookingCode, driver_id: driverId });
    setLastAction("Assigned");
    await loadPage();
  }

  async function loadPage() {
    const r = await fetch("/api/admin/livetrips/page-data?debug=1", { cache: "no-store" });
    const j: PageData = await r.json().catch(() => ({} as any));
    setZones(j.zones || []);
    setAllTrips(j.trips || j.bookings || j.data || []);
  }

  useEffect(() => {
    loadPage().catch((e) => setLastAction(e.message));
  }, []);

  const counts = useMemo(() => {
    const c: any = {
      dispatch: 0, pending: 0, assigned: 0, on_the_way: 0,
      arrived: 0, enroute: 0, on_trip: 0, completed: 0, cancelled: 0, problem: 0,
    };
    for (const t of allTrips) {
      const s = effectiveStatus(t);
      if (c[s] != null) c[s]++;
      if (isActiveTripStatus(s)) c.dispatch++;
      if (computeIsProblem(t)) c.problem++;
    }
    return c;
  }, [allTrips]);

  const visibleTrips = useMemo(() => {
    if (tripFilter === "dispatch") {
      return allTrips.filter(t => isActiveTripStatus(effectiveStatus(t)));
    }
    if (tripFilter === "problem") {
      return allTrips.filter(t => computeIsProblem(t));
    }
    return allTrips.filter(t => effectiveStatus(t) === tripFilter);
  }, [tripFilter, allTrips]);

  const showThresholds =
    `Stuck watcher thresholds: on_the_way ---- ${STUCK_THRESHOLDS_MIN.on_the_way} min, ` +
    `on_trip ---- ${STUCK_THRESHOLDS_MIN.on_trip} min`;

  /* -------------------- JSX -------------------- */

  return (
    <div className="p-4">
      <h1 className="text-xl font-semibold mb-2">Live Trips</h1>

      <div className="flex flex-wrap gap-2 mb-3">
        {(["dispatch","pending","assigned","on_the_way","arrived","enroute","on_trip","completed","cancelled","problem"] as FilterKey[])
          .map(k => (
            <button key={k} className="border px-3 py-1 rounded"
              onClick={() => setTripFilter(k)}
              title={k === "problem" ? showThresholds : undefined}>
              {k} ({counts[k] ?? 0})
            </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border rounded">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="p-2">Code</th>
                <th className="p-2">Status</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleTrips.map(t => {
                const s = normStatus(t.status);
                return (
                  <tr key={normTripId(t)}>
                    <td className="p-2">{t.booking_code}</td>
                    <td className="p-2">{s}</td>
                    <td className="p-2 flex gap-2">
                      <button onClick={() => updateTripStatus(t.booking_code!, "on_the_way")}>On the way</button>
                      <button onClick={() => updateTripStatus(t.booking_code!, "arrived")}>Arrived</button>
                      <button onClick={() => updateTripStatus(t.booking_code!, "on_trip")}>Start</button>
                      <button onClick={() => updateTripStatus(t.booking_code!, "completed")}>Drop off</button>

                      {computeIsProblem(t) && (
                        <>
                          <button onClick={() => callLiveTripsAction("NUDGE_DRIVER", t)}>Nudge</button>
                          <button onClick={() => callLiveTripsAction("REASSIGN_DRIVER", t)}>Reassign</button>
                          <button onClick={() => callLiveTripsAction("AUTO_ASSIGN", t)}>Auto-assign</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="border rounded h-[520px]">
          <LiveTripsMap
            trips={visibleTrips as any}
            selectedTripId={selectedTripId}
            stuckTripIds={new Set()}
          />
        </div>
      </div>
    </div>
  );
}
