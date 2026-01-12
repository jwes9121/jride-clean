"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import LiveTripsMap from "./components/LiveTripsMap";
import SmartAutoAssignSuggestions from "./components/SmartAutoAssignSuggestions";

// Optional panels (only render if present)
let TripWalletPanel: any = null;
let TripLifecycleActions: any = null;
try { TripWalletPanel = require("./components/TripWalletPanel").default; } catch {}
try { TripLifecycleActions = require("./components/TripLifecycleActions").default; } catch {}

/* -------------------- types (flexible) -------------------- */

type ZoneRow = {
  zone_id: string;
  zone_name: string;
  color_hex?: string | null;
  status?: string | null;
};

type TripRow = {
  id?: any;
  uuid?: any;

  booking_code?: string | null;
  status?: string | null;
  town?: string | null;
  zone?: string | null;

  passenger_name?: string | null;
  rider_name?: string | null;

  pickup_label?: string | null;
  dropoff_label?: string | null;

  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;

  driver_id?: any;
  assigned_driver_id?: any;
  driverId?: any;

  updated_at?: string | null;
  created_at?: string | null;

  [k: string]: any;
};

type DriverRow = {
  driver_id?: string | null;
  id?: string | null;

  name?: string | null;
  driver_name?: string | null;

  phone?: string | null;
  driver_phone?: string | null;

  town?: string | null;
  status?: string | null;

  lat?: number | null;
  lng?: number | null;

  updated_at?: string | null;
  [k: string]: any;
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

/* -------------------- helpers -------------------- */

function normStatus(s?: any) {
  return String(s || "").trim().toLowerCase();
}


function hasValidCoords(t: any): boolean {
  const pLat = Number((t as any)?.pickup_lat ?? (t as any)?.pickupLatitude ?? (t as any)?.from_lat ?? (t as any)?.fromLat ?? null);
  const pLng = Number((t as any)?.pickup_lng ?? (t as any)?.pickupLongitude ?? (t as any)?.from_lng ?? (t as any)?.fromLng ?? null);
  const dLat = Number((t as any)?.dropoff_lat ?? (t as any)?.dropoffLatitude ?? (t as any)?.to_lat ?? (t as any)?.toLat ?? null);
  const dLng = Number((t as any)?.dropoff_lng ?? (t as any)?.dropoffLongitude ?? (t as any)?.to_lng ?? (t as any)?.toLng ?? null);

  const ok = (n: any) => Number.isFinite(n) && n !== 0;
  return ok(pLat) && ok(pLng) && ok(dLat) && ok(dLng);
}
function hasDriver(t: any): boolean {
  const v = (t as any)?.driver_id ?? (t as any)?.assigned_driver_id ?? (t as any)?.driverId ?? null;
  return v != null && String(v).length > 0;
}

function effectiveStatus(t: any): string {
  const s = normStatus((t as any)?.status);
  if (s === "requested") return "pending";
  if (s === "assigned" && !hasDriver(t)) return "pending";
  return s;
}
function nextLifecycleStatus(sEff: string): string | null {
  // Next-only lifecycle:
  // assigned -> on_the_way -> arrived -> on_trip -> completed
  // Anything else: no next step
  const s = normStatus(sEff);
  if (s === "assigned") return "on_the_way";
  if (s === "on_the_way") return "arrived";
  if (s === "arrived" || s === "enroute") return "on_trip";
  if (s === "on_trip") return "completed";
  return null;
}



function isNextTransition(currentEff: string, target: string): boolean {
  const next = nextLifecycleStatus(currentEff);
  return normStatus(next) === normStatus(target);
}
function tripKey(t: TripRow): string {
  return String((t as any)?.uuid ?? (t as any)?.id ?? (t as any)?.booking_code ?? "");
}

function minutesSince(iso?: string | null): number {
  if (!iso) return 999999;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 999999;
  return Math.floor((Date.now() - ms) / 60000);
}


function recentlyNudged(nudgedAt: Record<string, number>, key: string, windowMs = 2 * 60 * 1000) {
  const t = nudgedAt[key];
  if (!t) return false;
  return (Date.now() - t) < windowMs;
}

const STUCK_THRESHOLDS_MIN = {
  on_the_way: 15,
  on_trip: 25,
  arrived: 15,
  enroute: 15,
};

function isActiveTripStatus(s: string) {
  return ["pending", "assigned", "on_the_way", "arrived", "enroute", "on_trip"].includes(s);
}

function computeProblemReason(t: TripRow): string | null {
  const s = normStatus((t as any)?.status);
  const mins = minutesSince((t as any)?.updated_at || (t as any)?.created_at || null);

  const coordsOk = hasValidCoords(t);
  

  if (isActiveTripStatus(s) && !coordsOk) return "Missing pickup/dropoff coordinates";
  if (s === "assigned" && !hasDriver(t)) return "Assigned but no driver linked";
  if (s === "on_the_way" && mins >= STUCK_THRESHOLDS_MIN.on_the_way) return `On the way stale (${mins}m)`;
  if (s === "arrived" && mins >= STUCK_THRESHOLDS_MIN.arrived) return `Arrived stale (${mins}m)`;
  if (s === "enroute" && mins >= STUCK_THRESHOLDS_MIN.enroute) return `Enroute stale (${mins}m)`;
  if (s === "on_trip" && mins >= STUCK_THRESHOLDS_MIN.on_trip) return `On trip stale (${mins}m)`;

  return null;
}

function isProblemTrip(t: TripRow): boolean {
  return !!computeProblemReason(t);
}

function pillClass(active: boolean) {
  return [
    "rounded-full border px-3 py-1 text-sm",
    active ? "bg-black text-white border-black" : "bg-white text-gray-800 hover:bg-gray-50",
  ].join(" ");
}

function badgeClass(kind: "problem" | "stale" | "ok") {
  if (kind === "problem") return "inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-700";
  if (kind === "stale") return "inline-flex items-center rounded-full border border-yellow-300 bg-yellow-50 px-2 py-0.5 text-xs text-yellow-800";
  return "inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600";
}

/* -------------------- actions API helper -------------------- */

async function callLiveTripsAction(action: "NUDGE_DRIVER" | "REASSIGN_DRIVER" | "AUTO_ASSIGN" | "ARCHIVE_TEST_TRIPS" , t: any) {
  const booking_code = (t as any)?.booking_code ?? (t as any)?.bookingCode ?? null;
  const trip_id = (t as any)?.id ?? (t as any)?.uuid ?? null;

  const res = await fetch("/api/admin/livetrips/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
        action,
        trip_id: (String((t as any).id ?? (t as any).trip_id ?? (t as any).tripId ?? "").trim() || null),
        booking_code: (String((t as any).booking_code ?? (t as any).bookingCode ?? "").trim() || null),
      }),
  });

  const js: any = await res.json().catch(() => ({}));
  if (!res.ok || !js?.ok) {
    const msg = js?.message || js?.code || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return js;
}

/* ==================== COMPONENT ==================== */

export default function LiveTripsClient() {
  const tableRef = useRef<HTMLDivElement | null>(null);

  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [allTrips, setAllTrips] = useState<TripRow[]>([]);
  const [tripFilter, setTripFilter] = useState<FilterKey>("dispatch");

  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const selectedTrip = useMemo(() => {
    if (!selectedTripId) return null;
    return allTrips.find((t) => tripKey(t) === selectedTripId) || null;
  }, [selectedTripId, allTrips]);

  const [lastAction, setLastAction] = useState<string>("");
  const [nudgedAt, setNudgedAt] = useState<Record<string, number>>({});
  // ===== PHASE B: UI-only escalation (flagging) =====
  // Flagged trips are UI-only (no backend). Used for dispatcher follow-up.
  const [flaggedAt, setFlaggedAt] = useState<Record<string, number>>({});
  const [escalationStep, setEscalationStep] = useState<Record<string, number>>({}); // 0 none, 1 nudged, 2 auto-assigned, 3 flagged
  const [pendingAutoAssignById, setPendingAutoAssignById] = useState<Record<string, boolean>>({}); // UI lock for AUTO_ASSIGN

  function isFlaggedTripKey(key: string): boolean {
    return !!(flaggedAt as any)[key];
  }

  function setFlagTripKey(key: string, step: number) {
    if (!key) return;
    setFlaggedAt((prev) => ({ ...(prev || {}), [key]: Date.now() }));
    setEscalationStep((prev) => ({ ...(prev || {}), [key]: step }));
  }

  function setEscStep(key: string, step: number) {
    if (!key) return;
    setEscalationStep((prev) => ({ ...(prev || {}), [key]: step }));
  }


  // ===== PHASE 9B: UI-only auto-resolve (nudge cooldown) =====
  // After Nudge, hide PROBLEM badge/count/filter for a cooldown window.
  // If still stuck after cooldown, PROBLEM can re-appear.
  const NUDGE_COOLDOWN_MS = 6 * 60 * 1000; // 6 minutes
  const NUDGE_MAX_KEEP_MS = 30 * 60 * 1000; // safety prune

  function isCoolingTrip(key: string): boolean {
    return recentlyNudged(nudgedAt, key, NUDGE_COOLDOWN_MS);
  }

  function isProblemEffective(t: TripRow): boolean {
    const key = tripKey(t);
    if (!key) return isProblemTrip(t);
    if (isCoolingTrip(key)) return false;
    return isProblemTrip(t);
  }

  function coolTextForTripKey(key: string): string | null {
    const t = (nudgedAt as any)[key] as number | undefined;
    if (!t) return null;
    const now = Date.now();
    const elapsedMs = Math.max(0, now - t);
    const remainMs = Math.max(0, NUDGE_COOLDOWN_MS - elapsedMs);
    const agoMin = Math.floor(elapsedMs / 60000);
    const leftMin = Math.ceil(remainMs / 60000);
    if (elapsedMs >= NUDGE_COOLDOWN_MS) return null;
    return "Nudged " + String(agoMin) + "m ago (cooldown " + String(leftMin) + "m)";
  }
const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [driversDebug, setDriversDebug] = useState<string>("Drivers: not loaded yet");
  const [manualDriverId, setManualDriverId] = useState<string>("");

  async function postJson(url: string, body: any) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const j = await r.json().catch(() => ({}));

    if (!r.ok || j?.ok === false) {
      const code = j?.code || "REQUEST_FAILED";
      const msg  = j?.message || j?.error || ("HTTP " + r.status);
      throw new Error(code + ": " + msg);
    }
    return j;
  }

  async function loadPage() {
    const r = await fetch("/api/admin/livetrips/page-data", { cache: "no-store" });
    const j: PageData = await r.json().catch(() => ({} as any));
    setZones(j.zones || []);
    setAllTrips((j.trips || j.bookings || j.data || []) as any[]);
  }

  async function loadDrivers() {
    try {
      const r = await fetch("/api/admin/driver_locations", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      const list: DriverRow[] = (Array.isArray(j) ? j : (j?.drivers || j?.data || [])) as any[];
      setDrivers(list);
      setDriversDebug(`Drivers: loaded from /api/admin/driver_locations (${list.length})`);
    } catch (e: any) {
      setDriversDebug(`Drivers: failed (${String(e?.message || e)})`);
    }
  }

  useEffect(() => {
    loadPage().catch((e) => setLastAction(String(e?.message || e)));
    loadDrivers().catch(() => {});
  }, []);

  // Prune nudgedAt:
  // - trip disappeared
  // - trip completed/cancelled
  // - trip updated after nudge (activity happened)
  // - no longer a problem
  // - too old record
  useEffect(() => {
    const now = Date.now();
    setNudgedAt((prev) => {
      const keys = Object.keys(prev || {});
      if (!keys.length) return prev;

      const next: Record<string, number> = { ...(prev || {}) };
      let changed = false;

      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const nAt = (next as any)[k] as number | undefined;
        if (!nAt) { delete (next as any)[k]; changed = true; continue; }

        if (now - nAt > NUDGE_MAX_KEEP_MS) { delete (next as any)[k]; changed = true; continue; }

        const tr = allTrips.find((t) => tripKey(t) === k) || null;
        if (!tr) { delete (next as any)[k]; changed = true; continue; }

        const st = effectiveStatus(tr);
        if (st === "completed" || st === "cancelled") { delete (next as any)[k]; changed = true; continue; }

        const upd = new Date((tr as any)?.updated_at || (tr as any)?.created_at || 0).getTime() || 0;
        if (upd && upd > nAt) { delete (next as any)[k]; changed = true; continue; }

        if (!isProblemTrip(tr)) { delete (next as any)[k]; changed = true; continue; }
      }

      return changed ? next : prev;
    });
  }, [allTrips, nudgedAt]);


  function setFilterAndFocus(f: FilterKey) {
    setTripFilter(f);
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }
  async function assignDriver(bookingCode: string, driverId: string) {
    if (!bookingCode || !driverId) return;
    setLastAction("Assigning...");
    await postJson("/api/dispatch/assign", { booking_code: bookingCode, bookingCode, driver_id: driverId, driverId });
    setLastAction("Assigned");
    await loadPage();
  }

    async function updateTripStatus(bookingCode: string, status: string) {
    if (!bookingCode || !status) return;
    try {
      setLastAction("Updating status...");
      await postJson("/api/dispatch/status", { booking_code: bookingCode, bookingCode, status });
      setLastAction("Status updated");
      await loadPage();
    } catch (e: any) {
      setLastAction("Status update failed: " + String(e?.message || e));
    }
  }

  // backend must honor force:true
    async function forceTripStatus(bookingCode: string, status: string) {
    if (!bookingCode || !status) return;
    try {
      setLastAction("Forcing status...");
      await postJson("/api/dispatch/status", { booking_code: bookingCode, bookingCode, status, force: true });
      setLastAction("Force status sent");
      await loadPage();
    } catch (e: any) {
      setLastAction("Force failed: " + String(e?.message || e));
    }
  }

  const counts = useMemo(() => {
    const c: any = {
      dispatch: 0,
      pending: 0,
      assigned: 0,
      on_the_way: 0,
      arrived: 0,
      enroute: 0,
      on_trip: 0,
      completed: 0,
      cancelled: 0,
      problem: 0,
    };

    for (const t of allTrips) {
      const s = effectiveStatus(t);
      if (c[s] != null) c[s]++;
      if (isActiveTripStatus(s)) c.dispatch++;
      if (isProblemEffective(t)) c.problem++;
    }
    return c;
  }, [allTrips, nudgedAt]);

  const visibleTrips = useMemo(() => {
    if (tripFilter === "dispatch") return allTrips.filter((t) => isActiveTripStatus(effectiveStatus(t)));
    if (tripFilter === "problem") return allTrips.filter((t) => isProblemEffective(t));
    return allTrips.filter((t) => effectiveStatus(t) === tripFilter);
  }, [tripFilter, allTrips, nudgedAt]);

  const shown = visibleTrips.length;

  const showThresholds =
    `Stuck watcher thresholds: on_the_way ---- ${STUCK_THRESHOLDS_MIN.on_the_way} min, ` +
    `on_trip ---- ${STUCK_THRESHOLDS_MIN.on_trip} min`;

  function onSelectTrip(t: TripRow) {
    setSelectedTripId(tripKey(t));
  }

  function tripLabelPassenger(t: TripRow) {
    return (t.passenger_name || t.rider_name || "-----") as any;
  }

  function tripZone(t: TripRow) {
    return (t.town || t.zone || "-----") as any;
  }

  function problemBadge(t: TripRow) {
    const r = computeProblemReason(t);
    if (!r) return null;
    return <span className={badgeClass("problem")}>PROBLEM</span>;
  }

  function isStale(t: TripRow) {
    const s = normStatus((t as any)?.status);
    const mins = minutesSince((t as any)?.updated_at || (t as any)?.created_at || null);
    if (s === "on_the_way" && mins >= STUCK_THRESHOLDS_MIN.on_the_way) return true;
    if (s === "arrived" && mins >= STUCK_THRESHOLDS_MIN.arrived) return true;
    if (s === "enroute" && mins >= STUCK_THRESHOLDS_MIN.enroute) return true;
    if (s === "on_trip" && mins >= STUCK_THRESHOLDS_MIN.on_trip) return true;
    return false;
  }

  function primaryProblemAction(t: TripRow): "NUDGE_DRIVER" | "AUTO_ASSIGN" | null {
    const reason = computeProblemReason(t) || "";
    if (reason.indexOf("Assigned but no driver") >= 0) return "AUTO_ASSIGN";
    if (reason.indexOf("stale") >= 0) return "NUDGE_DRIVER";
    return null;
  }

  const selectedBookingCode = (selectedTrip as any)?.booking_code || null;
  const selectedEff = selectedTrip ? effectiveStatus(selectedTrip as any) : "";


  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Live Trips</h1>
          <p className="text-sm text-gray-600">Monitor active bookings on the left and follow them on the map on the right.</p>
        </div>
        <div className="text-xs text-gray-600 text-right">
          <div className="font-medium">Stuck watcher thresholds</div>
          <div>
            on_the_way ---- {STUCK_THRESHOLDS_MIN.on_the_way} min, on_trip ---- {STUCK_THRESHOLDS_MIN.on_trip} min
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={pillClass(tripFilter === "dispatch")} onClick={() => setFilterAndFocus("dispatch")}>
          Dispatch <span className="text-xs opacity-80">({counts.dispatch})</span>
        </button>
        <button className={pillClass(tripFilter === "pending")} onClick={() => setFilterAndFocus("pending")}>
          Pending <span className="text-xs opacity-80">({counts.pending})</span>
        </button>
        <button className={pillClass(tripFilter === "assigned")} onClick={() => setFilterAndFocus("assigned")}>
          Assigned <span className="text-xs opacity-80">({counts.assigned})</span>
        </button>
        <button className={pillClass(tripFilter === "on_the_way")} onClick={() => setFilterAndFocus("on_the_way")}>
          On the way <span className="text-xs opacity-80">({counts.on_the_way})</span>
        </button>
        <button className={pillClass(tripFilter === "arrived")} onClick={() => setFilterAndFocus("arrived")}>
          Arrived <span className="text-xs opacity-80">({counts.arrived})</span>
        </button>
        <button className={pillClass(tripFilter === "enroute")} onClick={() => setFilterAndFocus("enroute")}>
          Enroute <span className="text-xs opacity-80">({counts.enroute})</span>
        </button>
        <button className={pillClass(tripFilter === "on_trip")} onClick={() => setFilterAndFocus("on_trip")}>
          On trip <span className="text-xs opacity-80">({counts.on_trip})</span>
        </button>
        <button className={pillClass(tripFilter === "completed")} onClick={() => setFilterAndFocus("completed")}>
          Completed <span className="text-xs opacity-80">({counts.completed})</span>
        </button>
        <button className={pillClass(tripFilter === "cancelled")} onClick={() => setFilterAndFocus("cancelled")}>
          Cancelled <span className="text-xs opacity-80">({counts.cancelled})</span>
        </button>
        <button
          className={[
            pillClass(tripFilter === "problem"),
            tripFilter === "problem" ? "" : "border-red-300 text-red-700 hover:bg-red-50",
          ].join(" ")}
          onClick={() => setFilterAndFocus("problem")}
          title={showThresholds}
        >
          Problem trips <span className="text-xs opacity-80">({counts.problem})</span>
        </button>

        <div className="ml-auto text-xs text-gray-600 self-center">
          {lastAction ? <span>Last action: {lastAction}</span> : <span>&nbsp;</span>}
        </div>
      </div>

      {/* Main split */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: table */}
        <div ref={tableRef} className="rounded-lg border bg-white overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
            <div className="font-semibold">Trips</div>
            <div className="text-xs text-gray-600">{shown} shown</div>
          </div>

          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white border-b">
                <tr>
                  <th className="text-left p-2 w-[220px]">Code</th>
                  <th className="text-left p-2 w-[140px]">Passenger</th>
                  <th className="text-left p-2">Pickup</th>
                  <th className="text-left p-2">Dropoff</th>
                  <th className="text-left p-2 w-[110px]">Status</th>
                  <th className="text-left p-2 w-[110px]">Zone</th>
                  <th className="text-left p-2 w-[320px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleTrips.map((t) => {
                  const key = tripKey(t);
                  const selected = selectedTripId === key;

                  const sRaw = normStatus((t as any)?.status);
                  const sEff = effectiveStatus(t);

                  const stale = isStale(t);
                  const probRaw = isProblemTrip(t);
                  const cooling = probRaw && isCoolingTrip(key);
                  const prob = probRaw && !cooling;
                  const coolText = cooling ? coolTextForTripKey(key) : null;
                  const reason = computeProblemReason(t);

                  const canAutoAssign = hasValidCoords(t);

                  const primary = primaryProblemAction(t);

                  return (
                    <tr
                      key={key}
                      className={[
                        "border-b cursor-pointer",
                        selected ? "bg-blue-50" : "hover:bg-gray-50",
                      ].join(" ")}
                      onClick={() => onSelectTrip(t)}
                    >
                      <td className="p-2 align-top">
                        <div className="font-medium">{(t as any)?.booking_code || "-----"}</div>
                        <div className="mt-1">
                          {prob ? <span className={badgeClass("problem")}>PROBLEM</span> : (cooling ? <span className={badgeClass("stale")}>COOLDOWN</span> : null)}
                          {cooling && coolText ? <span className="ml-2 text-xs text-gray-600">{coolText}</span> : null}
                          {stale ? <span className={"ml-2 " + badgeClass("stale")}>STUCK</span> : null}
                        </div>
                        {reason ? (
                          <div className="mt-1 text-xs text-gray-600">{reason}</div>
                        ) : null}
                      </td>

                      <td className="p-2 align-top">{tripLabelPassenger(t)}</td>

                      <td className="p-2 align-top">
                        <div className="whitespace-pre-line">{(t as any)?.pickup_label || "-----"}</div>
                      </td>

                      <td className="p-2 align-top">
                        <div className="whitespace-pre-line">{(t as any)?.dropoff_label || "-----"}</div>
                      </td>

                      <td className="p-2 align-top">
                        <span className={badgeClass(prob ? "problem" : (stale || cooling) ? "stale" : "ok")}>{sRaw || sEff}</span>
                      </td>

                      <td className="p-2 align-top">{tripZone(t)}</td>

                      <td className="p-2 align-top">
                        <div className="flex flex-wrap gap-2">
                          {/* Normal lifecycle path */}
                          <button
                            className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-50"
                            onClick={(e) => { e.stopPropagation(); updateTripStatus((t as any)?.booking_code, "on_the_way"); }}
                            disabled={!((t as any)?.booking_code) || nextLifecycleStatus(sEff) !== "on_the_way"}
                          >
                            On the way
                          </button>

                          <button
                            className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-50"
                            onClick={(e) => { e.stopPropagation(); updateTripStatus((t as any)?.booking_code, "arrived"); }}
                            disabled={!((t as any)?.booking_code) || nextLifecycleStatus(sEff) !== "arrived"}
                          >
                            Arrived
                          </button>

                          <button
                            className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-50"
                            onClick={(e) => { e.stopPropagation(); updateTripStatus((t as any)?.booking_code, "on_trip"); }}
                            disabled={!((t as any)?.booking_code) || nextLifecycleStatus(sEff) !== "on_trip"}
                            title="arrived/enroute -> on_trip"
                          >
                            Start trip
                          </button>

                          <button
                            className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-50"
                            onClick={(e) => { e.stopPropagation(); updateTripStatus((t as any)?.booking_code, "completed"); }}
                            disabled={!((t as any)?.booking_code) || nextLifecycleStatus(sEff) !== "completed"}
                            title="on_trip -> completed"
                          >
                            Drop off
                          </button>

                          {/* Force buttons (fallback) */}
                          <button
                            className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-50"
                            onClick={(e) => { e.stopPropagation(); forceTripStatus((t as any)?.booking_code, "on_trip"); }}
                            disabled={true}
                            title="Disabled in strict lifecycle mode"
                          >
                            Force start
                          </button>

                          <button
                            className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-50"
                            onClick={(e) => {
                            e.stopPropagation();
                            const st = effectiveStatus(t as any);
                            if (st === "on_trip") {
                              if (!confirm("Force end this on_trip ride? This will set status to completed.")) return;
                            }
                            forceTripStatus((t as any)?.booking_code, "completed");
                          }}
                            disabled={true}
                            title="Disabled in strict lifecycle mode"
                          >
                            Force end
                          </button>

                          {/* Problem actions */}
                          {probRaw ? (
                            <>
                              <button
                                className={[
                                  "rounded border px-2 py-1 text-xs hover:bg-gray-50",
                                  primary === "NUDGE_DRIVER" ? "bg-black text-white border-black" : (primary ? "opacity-60" : ""),
                                ].join(" ")}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    const k = tripKey(t);
                                    if (k) setNudgedAt((prev) => ({ ...prev, [k]: Date.now() }));
                                    setLastAction("Nudging...");
                                    await callLiveTripsAction("NUDGE_DRIVER", t);
                                    // Phase 9B.1: nudgedAt set optimistically on click
                                    setLastAction("Nudge sent");
                                    await loadPage();
                                  } catch (err: any) {
                                    setLastAction("Nudge failed: " + String(err?.message || err));
                                  }
                                }}
                              >
                                Nudge
                              </button>

                              <button
                                className={["rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40", primary ? "opacity-60" : ""].join(" ")}
                                disabled={!hasDriver(t)}
                                title={!hasDriver(t) ? "No driver linked" : "Clear driver and reset to assigned"}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!confirm("Reassign this trip? This clears driver link and resets status to assigned.")) return;
                                  try {
                                    setLastAction("Reassigning...");
                                    await callLiveTripsAction("REASSIGN_DRIVER", t);
                                    setLastAction("Reassigned");
                                    await loadPage();
                                  } catch (err: any) {
                                    setLastAction("Reassign failed: " + String(err?.message || err));
                                  }
                                }}
                              >
                                Reassign
                              </button>

                              <button
                                className={[
                                  "rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40",
                                  primary === "AUTO_ASSIGN" ? "bg-black text-white border-black" : (primary ? "opacity-60" : ""),
                                ].join(" ")}
                                disabled={!canAutoAssign || !!pendingAutoAssignById[String((t as any)?.id ?? (t as any)?.booking_id ?? (t as any)?.bookingId ?? "")]}
                                title={!canAutoAssign ? "Requires pickup & dropoff coordinates" : "Auto-assign nearest driver"}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    const _id = String((t as any)?.id ?? (t as any)?.booking_id ?? (t as any)?.bookingId ?? "");
if (_id) setPendingAutoAssignById((p) => ({ ...p, [_id]: true }));
setLastAction("Auto-assigning...");
await callLiveTripsAction("AUTO_ASSIGN", t);
setLastAction("Auto-assigned");
if (_id) setPendingAutoAssignById((p) => ({ ...p, [_id]: false }));
                                    await loadPage();
                                  } catch (err: any) {
                                    setLastAction("Auto-assign failed: " + String(err?.message || err));
                                  }
                                }}
                              >
                                Auto-assign
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {visibleTrips.length === 0 ? (
                  <tr>
                    <td className="p-3 text-gray-600" colSpan={7}>
                      No trips in this view.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="px-3 py-2 text-xs text-gray-600 border-t">
            {driversDebug}
          </div>

          {/* Bottom panels + actions (classic layout) */}
          <div className="border-t bg-gray-50 p-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded border bg-white p-3">
                <div className="font-semibold">Fare</div>
                <div className="text-sm text-gray-600">--</div>
              </div>
              <div className="rounded border bg-white p-3">
                <div className="font-semibold">Company cut</div>
                <div className="text-sm text-gray-600">--</div>
              </div>
              <div className="rounded border bg-white p-3">
                <div className="font-semibold">Trip actions</div>
                {selectedTrip ? (
                  <div className="text-sm text-gray-700">
                    <div>Code: {(selectedTrip as any)?.booking_code}</div>
                    <div>Status: {normStatus((selectedTrip as any)?.status)}</div>
                    <div className="mt-2 flex gap-2 flex-wrap">
                      <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-50"
                        onClick={() => updateTripStatus((selectedTrip as any)?.booking_code, "on_the_way")}
                        disabled={!selectedBookingCode}
                      >On the way</button>
                      <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-50"
                        onClick={() => updateTripStatus((selectedTrip as any)?.booking_code, "arrived")}
                        disabled={!selectedBookingCode}
                      >Arrived</button>
                      <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-50"
                        onClick={() => updateTripStatus((selectedTrip as any)?.booking_code, "on_trip")}
                        disabled={!selectedBookingCode}
                      >Start trip</button>
                      <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-50"
                        onClick={() => updateTripStatus((selectedTrip as any)?.booking_code, "completed")}
                        disabled={!selectedBookingCode}
                      >Drop off</button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-600">Select a trip to see actions.</div>
                )}
              </div>

              <div className="rounded border bg-white p-3">
                <div className="font-semibold">Driver payout</div>
                <div className="text-sm text-gray-600">--</div>
              </div>
              <div className="rounded border bg-white p-3">
                <div className="font-semibold">Driver wallet</div>
                <div className="text-sm text-gray-600">--</div>
                <div className="text-xs text-gray-500 mt-1">View ledger</div>
              </div>
              <div className="rounded border bg-white p-3">
                <div className="font-semibold">Vendor wallet</div>
                <div className="text-sm text-gray-600">--</div>
                <div className="text-xs text-gray-500 mt-1">View ledger</div>
              </div>
            </div>

            {/* Optional richer panels if your project has them */}
            {TripWalletPanel && selectedTrip ? (
              <div className="mt-3">
                <TripWalletPanel selectedTrip={selectedTrip} />
              </div>
            ) : null}
            {TripLifecycleActions && selectedTrip ? (
              <div className="mt-3">
                <TripLifecycleActions selectedTrip={selectedTrip} />
              </div>
            ) : null}

            {/* Manual assign */}
            <div className="mt-3 rounded border bg-white p-3">
              <div className="font-semibold mb-2">Assign driver (manual)</div>
              <div className="flex items-center gap-2">
                <select
                  className="border rounded px-2 py-1 text-sm w-[260px]"
                  value={manualDriverId}
                  onChange={(e) => setManualDriverId(e.target.value)}
                >
                  <option value="">Select driver</option>
                  {drivers.map((d, idx) => {
                    const id = String((d as any)?.driver_id ?? (d as any)?.id ?? "");
                    const name = String((d as any)?.name ?? (d as any)?.driver_name ?? "Driver");
                    const town = String((d as any)?.town ?? "");
                    const status = String((d as any)?.status ?? "");
                    const label = [name, town ? `(${town})` : "", status ? `- ${status}` : ""].filter(Boolean).join(" ");
                    return (
                      <option key={id || idx} value={id}>
                        {label}
                      </option>
                    );
                  })}
                </select>

                <button
                  className="rounded border px-3 py-1 text-sm hover:bg-gray-50"
                  onClick={() => selectedBookingCode && manualDriverId ? assignDriver(selectedBookingCode, manualDriverId) : null}
                  disabled={!selectedBookingCode || !manualDriverId}
                >
                  Assign
                </button>

                <button
                  className="rounded border px-3 py-1 text-sm hover:bg-gray-50"
                  onClick={() => loadPage()}
                >
                  Refresh now
                </button>
              </div>
              <div className="text-xs text-gray-500 mt-2">Select a trip to enable assignment suggestions.</div>
            </div>
          </div>
        </div>

        {/* Right: map (unchanged) */}
        <div className="rounded-lg border bg-white overflow-hidden">
          <div className="h-[720px]">
            <LiveTripsMap
              trips={
  [...(visibleTrips as any)].sort((a: any, b: any) => {
    const ap = isProblemTrip(a) ? 1 : 0;
    const bp = isProblemTrip(b) ? 1 : 0;
    if (ap !== bp) return bp - ap;

    const am = minutesSince(a?.updated_at || a?.created_at || null);
    const bm = minutesSince(b?.updated_at || b?.created_at || null);
    if (am !== bm) return bm - am;

    return 0;
  }) as any
}
              selectedTripId={selectedTripId}
              stuckTripIds={new Set(
                visibleTrips.filter((t) => isStale(t)).map((t) => tripKey(t))
              )}
            />
          </div>

          {/* Suggestions panel (keep as is) */}
          <div className="border-t p-3">
            <SmartAutoAssignSuggestions
              drivers={(drivers || []).map((d: any, idx: number) => {
                const id = String(d?.id ?? d?.driver_id ?? idx);
                const name = String(d?.name ?? d?.driver_name ?? "Driver");
                const lat = Number(d?.lat ?? d?.latitude ?? d?.driver_lat ?? 0);
                const lng = Number(d?.lng ?? d?.longitude ?? d?.driver_lng ?? 0);
                const zone = String(d?.zone ?? d?.town ?? "Unknown");
                const homeTown = String(d?.homeTown ?? d?.home_town ?? d?.town ?? "Unknown");
                const status = String(d?.status ?? "online");
                return { id, name, lat, lng, zone, homeTown, status };
              })}
              trip={
                selectedTrip
                  ? {
                      id: String((selectedTrip as any)?.id ?? (selectedTrip as any)?.uuid ?? (selectedTrip as any)?.booking_code ?? ""),
                      pickupLat: Number((selectedTrip as any)?.pickup_lat ?? (selectedTrip as any)?.pickupLat ?? 0),
                      pickupLng: Number((selectedTrip as any)?.pickup_lng ?? (selectedTrip as any)?.pickupLng ?? 0),
                      zone: String((selectedTrip as any)?.town ?? (selectedTrip as any)?.zone ?? "Unknown"),
                      tripType: String((selectedTrip as any)?.trip_type ?? (selectedTrip as any)?.tripType ?? (selectedTrip as any)?.service_type ?? ""),
                    }
                  : null
              }
              zoneStats={Object.fromEntries(
                (zones || []).map((z: any) => {
                  const key = String(z?.zone_name ?? z?.zone ?? z?.town ?? z?.zone_id ?? "Unknown");
                  const status = String(z?.status ?? "OK");
                  return [key, { util: 0, status }];
                })
              ) as any}
              assignedDriverId={String(
                (selectedTrip as any)?.driver_id ??
                  (selectedTrip as any)?.assigned_driver_id ??
                  (selectedTrip as any)?.driverId ??
                  ""
              ) || null}
              assigningDriverId={null}
              canAssign={
                !!selectedTrip &&
                !["on_trip", "completed", "cancelled"].includes(String((selectedTrip as any)?.status || "").toLowerCase())
              }
              lockReason="Trip already started"
              onAssign={async (driverId: string) => {
                if (!selectedTrip) return;
                const bookingCode =
                  (selectedTrip as any)?.booking_code ??
                  (selectedTrip as any)?.bookingCode ??
                  null;
                if (!bookingCode) return;
                await assignDriver(bookingCode, driverId);
              }}
            /></div>
        </div>
      </div>
    </div>
  );
}














