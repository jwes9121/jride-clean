param(
  [Parameter(Mandatory=$true)]
  [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom {
  param([string]$Path, [string]$Text)
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

function Backup-File {
  param([string]$Path, [string]$Tag)
  if (-not (Test-Path -LiteralPath $Path)) { throw "File not found: $Path" }
  $bakDir = Join-Path $RepoRoot "_patch_bak"
  if (-not (Test-Path -LiteralPath $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir | Out-Null
  }
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $bak = Join-Path $bakDir ((Split-Path $Path -Leaf) + ".bak.$Tag.$stamp")
  Copy-Item -LiteralPath $Path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Assert-Ascii {
  param([string]$Path)
  $text = [System.IO.File]::ReadAllText($Path)
  $bad = @()
  for ($i = 0; $i -lt $text.Length; $i++) {
    $code = [int][char]$text[$i]
    if ($code -gt 127) {
      $bad += ("U+{0:X4} at char {1}" -f $code, $i)
      if ($bad.Count -ge 8) { break }
    }
  }
  if ($bad.Count -gt 0) {
    throw ((Split-Path $Path -Leaf) + " still contains non-ASCII characters: " + ($bad -join ', '))
  }
}

Write-Host "== PATCH JRIDE LIVETRIPS CLIENT SYNTAX + ASCII FIX V1 (PS5-safe) =="
Write-Host "RepoRoot: $RepoRoot"

$clientPath = Join-Path $RepoRoot "app\admin\livetrips\LiveTripsClient.tsx"
$smartPath  = Join-Path $RepoRoot "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx"

Backup-File -Path $clientPath -Tag "LIVETRIPS_CLIENT_SYNTAX_ASCII_FIX_V1"
Backup-File -Path $smartPath  -Tag "SMART_ASSIGN_SYNTAX_ASCII_FIX_V1"

$clientText = @'
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

function minutesSince(iso?: string | null): number {
  if (!iso) return 999999;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 999999;
  return Math.floor((Date.now() - t) / 60000);
}

function isActiveTripStatus(s: string) {
  return ["assigned", "accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip"].includes(s);
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

  const hasPickup = Number.isFinite(t.pickup_lat as any) && Number.isFinite(t.pickup_lng as any);
  const hasDropoff = Number.isFinite(t.dropoff_lat as any) && Number.isFinite(t.dropoff_lng as any);
  const missingCoords = isActiveTripStatus(s) && (!hasPickup || !hasDropoff);

  return isStuck || missingCoords;
}

type FilterKey =
  | "dispatch"
  | "assigned"
  | "accepted"
  | "fare_proposed"
  | "ready"
  | "on_the_way"
  | "arrived"
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
    const r = await fetch("/api/admin/livetrips/page-data?debug=1", { cache: "no-store" });
    const j: PageData = await r.json().catch(() => ({} as any));

    const z = safeArray<ZoneRow>(j.zones);
    const trips = parseTripsFromPageData(j);
    const normalized = trips.map((t) => ({
      ...t,
      booking_code: t.booking_code ?? (t as any).bookingCode ?? null,
      pickup_label: t.pickup_label ?? (t as any).from_label ?? (t as any).fromLabel ?? null,
      dropoff_label: t.dropoff_label ?? (t as any).to_label ?? (t as any).toLabel ?? null,
      zone: t.zone ?? (t as any).town ?? (t as any).zone_name ?? null,
      status: t.status ?? "assigned",
    }));

    setZones(z);
    setAllTrips(normalized);

    const ids = new Set(normalized.map(normTripId).filter(Boolean));
    if (selectedTripId && !ids.has(selectedTripId)) {
      setSelectedTripId(null);
    }
  }

  async function loadDrivers() {
    const endpoints = [
      "/api/admin/driver-locations",
      "/api/dispatch/online-drivers",
      "/api/admin/livetrips/online-drivers",
    ];

    let loaded: any[] = [];
    let debug = "";

    for (const ep of endpoints) {
      try {
        const r = await fetch(ep, { cache: "no-store" });
        const txt = await r.text();
        let j: any = {};
        try { j = txt ? JSON.parse(txt) : {}; } catch (_) { j = {}; }

        const candidates = [j.drivers, j.data, j.rows, Array.isArray(j) ? j : null];
        for (const c of candidates) {
          const arr = safeArray<any>(c);
          if (arr.length) {
            loaded = arr;
            debug = ep + ": " + arr.length + " driver(s)";
            break;
          }
        }
        if (loaded.length) break;
        debug = ep + ": empty";
      } catch (e: any) {
        debug = ep + ": " + String(e?.message || e || "ERR");
      }
    }

    const normalized: DriverRow[] = loaded.map((d: any) => ({
      driver_id: d.driver_id ?? d.id ?? d.uuid ?? null,
      name: d.name ?? d.driver_name ?? d.full_name ?? "Driver",
      phone: d.phone ?? d.mobile ?? null,
      town: d.town ?? d.zone ?? d.home_town ?? null,
      status: d.status ?? d.state ?? "online",
      lat: typeof d.lat === "number" ? d.lat : typeof d.latitude === "number" ? d.latitude : null,
      lng: typeof d.lng === "number" ? d.lng : typeof d.longitude === "number" ? d.longitude : null,
      updated_at: d.updated_at ?? null,
    }));

    setDrivers(normalized);
    setDriversDebug(debug || (normalized.length ? (normalized.length + " driver(s)") : "none"));
  }

  useEffect(() => {
    loadPage().catch((e) => setLastAction(String(e?.message || e)));
    loadDrivers().catch((e) => setDriversDebug(String(e?.message || e)));
  }, []);

  const stuckTripIds = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTrips) {
      if (computeIsProblem(t)) set.add(normTripId(t));
    }
    return set;
  }, [allTrips]);

  const counts = useMemo(() => {
    const c = {
      dispatch: 0,
      assigned: 0,
      accepted: 0,
      fare_proposed: 0,
      ready: 0,
      on_the_way: 0,
      arrived: 0,
      on_trip: 0,
      completed: 0,
      cancelled: 0,
      problem: stuckTripIds.size,
    };

    for (const t of allTrips) {
      const s = normStatus(t.status);
      if (["assigned", "accepted", "fare_proposed", "ready"].includes(s)) c.dispatch += 1;
      if (s === "assigned") c.assigned += 1;
      else if (s === "accepted") c.accepted += 1;
      else if (s === "fare_proposed") c.fare_proposed += 1;
      else if (s === "ready") c.ready += 1;
      else if (s === "on_the_way") c.on_the_way += 1;
      else if (s === "arrived") c.arrived += 1;
      else if (s === "on_trip") c.on_trip += 1;
      else if (s === "completed") c.completed += 1;
      else if (s === "cancelled") c.cancelled += 1;
    }
    return c;
  }, [allTrips, stuckTripIds]);

  const visibleTrips = useMemo(() => {
    let out = allTrips.filter((t) => {
      const s = normStatus(t.status);
      if (tripFilter === "dispatch") return ["assigned", "accepted", "fare_proposed", "ready"].includes(s);
      if (tripFilter === "problem") return stuckTripIds.has(normTripId(t));
      if (tripFilter === "completed" || tripFilter === "cancelled") return s === tripFilter;
      return s === tripFilter;
    });

    out.sort((a, b) => {
      const ta = new Date((a.updated_at || a.created_at || 0) as any).getTime() || 0;
      const tb = new Date((b.updated_at || b.created_at || 0) as any).getTime() || 0;
      return tb - ta;
    });

    if (out.length) {
      const ids = new Set(out.map(normTripId));
      if (!selectedTripId || !ids.has(selectedTripId)) setSelectedTripId(normTripId(out[0]));
    } else {
      setSelectedTripId(null);
    }

    return out;
  }, [allTrips, tripFilter, stuckTripIds, selectedTripId]);

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
    setTimeout(() => {
      if (tableRef.current) tableRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
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
  }

  async function updateTripStatus(bookingCode: string, status: string) {
    if (!bookingCode || !status) return;
    setLastAction("Updating status...");
    await postJson("/api/dispatch/status", { bookingCode, status });
    setLastAction("Status updated");
    await loadPage();
  }

  const showThresholds = "Stuck watcher thresholds: on_the_way >= " + STUCK_THRESHOLDS_MIN.on_the_way + " min, on_trip >= " + STUCK_THRESHOLDS_MIN.on_trip + " min";

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Live Trips</h1>
          <p className="text-sm text-gray-600">Monitor active bookings on the left and follow them on the map on the right.</p>
        </div>
        <div className="text-xs text-gray-600 text-right">
          <div className="font-medium">Stuck watcher thresholds</div>
          <div>on_the_way &gt;= {STUCK_THRESHOLDS_MIN.on_the_way} min, on_trip &gt;= {STUCK_THRESHOLDS_MIN.on_trip} min</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button className={pillClass(tripFilter === "dispatch")} onClick={() => setFilterAndFocus("dispatch")}>Dispatch <span className="text-xs opacity-80">{counts.dispatch}</span></button>
        <button className={pillClass(tripFilter === "assigned")} onClick={() => setFilterAndFocus("assigned")}>Assigned <span className="text-xs opacity-80">{counts.assigned}</span></button>
        <button className={pillClass(tripFilter === "accepted")} onClick={() => setFilterAndFocus("accepted")}>Accepted <span className="text-xs opacity-80">{counts.accepted}</span></button>
        <button className={pillClass(tripFilter === "fare_proposed")} onClick={() => setFilterAndFocus("fare_proposed")}>Fare proposed <span className="text-xs opacity-80">{counts.fare_proposed}</span></button>
        <button className={pillClass(tripFilter === "ready")} onClick={() => setFilterAndFocus("ready")}>Ready <span className="text-xs opacity-80">{counts.ready}</span></button>
        <button className={pillClass(tripFilter === "on_the_way")} onClick={() => setFilterAndFocus("on_the_way")}>On the way <span className="text-xs opacity-80">{counts.on_the_way}</span></button>
        <button className={pillClass(tripFilter === "arrived")} onClick={() => setFilterAndFocus("arrived")}>Arrived <span className="text-xs opacity-80">{counts.arrived}</span></button>
        <button className={pillClass(tripFilter === "on_trip")} onClick={() => setFilterAndFocus("on_trip")}>On trip <span className="text-xs opacity-80">{counts.on_trip}</span></button>
        <button className={pillClass(tripFilter === "completed")} onClick={() => setFilterAndFocus("completed")}>Completed <span className="text-xs opacity-80">{counts.completed}</span></button>
        <button className={pillClass(tripFilter === "cancelled")} onClick={() => setFilterAndFocus("cancelled")}>Cancelled <span className="text-xs opacity-80">{counts.cancelled}</span></button>
        <button className={[pillClass(tripFilter === "problem"), tripFilter === "problem" ? "" : "border-red-300 text-red-700 hover:bg-red-50"].join(" ")} onClick={() => setFilterAndFocus("problem")} title={showThresholds}>Problem trips <span className="text-xs opacity-80">{counts.problem}</span></button>
        <div className="ml-auto text-xs text-gray-600 self-center">{lastAction ? <span>Last action: {lastAction}</span> : <span>&nbsp;</span>}</div>
      </div>

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

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4" ref={tableRef}>
        <div className="rounded-lg border">
          <div className="p-3 border-b flex items-center justify-between">
            <div className="font-semibold">{tripFilter === "dispatch" ? "Dispatch view (Assigned + Accepted + Fare proposed + Ready)" : "Trips"}</div>
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
                  <tr><td className="p-3 text-gray-600" colSpan={7}>No trips in this view.</td></tr>
                ) : (
                  visibleTrips.map((t) => {
                    const id = normTripId(t);
                    const isSel = selectedTripId === id;
                    const isProblem = stuckTripIds.has(id);
                    const s = normStatus(t.status);
                    return (
                      <tr key={id || String(Math.random())} className={["border-b cursor-pointer", isSel ? "bg-blue-50" : "hover:bg-gray-50"].join(" ")} onClick={() => setSelectedTripId(id)}>
                        <td className="p-2 font-medium">{t.booking_code || "-"}{isProblem ? <span className="ml-2 inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-700">PROBLEM</span> : null}</td>
                        <td className="p-2">{t.passenger_name || "-"}</td>
                        <td className="p-2">{t.pickup_label || "-"}</td>
                        <td className="p-2">{t.dropoff_label || "-"}</td>
                        <td className="p-2"><span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">{s || "-"}</span></td>
                        <td className="p-2">{t.zone || t.town || "-"}</td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-2 items-center">
                            <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" onClick={(e) => { e.stopPropagation(); if (!t.booking_code) return; updateTripStatus(t.booking_code, "on_the_way").catch((err) => setLastAction(String(err?.message || err))); }} disabled={s !== "ready" && s !== "assigned"} title={s !== "ready" && s !== "assigned" ? "Allowed only when status=ready or assigned" : "Mark on_the_way"}>On the way</button>
                            <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" onClick={(e) => { e.stopPropagation(); if (!t.booking_code) return; updateTripStatus(t.booking_code, "arrived").catch((err) => setLastAction(String(err?.message || err))); }} disabled={s !== "on_the_way"} title={s !== "on_the_way" ? "Allowed only when status=on_the_way" : "Mark arrived"}>Arrived</button>
                            <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" onClick={(e) => { e.stopPropagation(); if (!t.booking_code) return; updateTripStatus(t.booking_code, "on_trip").catch((err) => setLastAction(String(err?.message || err))); }} disabled={s !== "arrived" && s !== "on_the_way"} title={s !== "arrived" && s !== "on_the_way" ? "Allowed only when status=arrived or on_the_way" : "Start trip"}>Start trip</button>
                            <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" onClick={(e) => { e.stopPropagation(); if (!t.booking_code) return; updateTripStatus(t.booking_code, "completed").catch((err) => setLastAction(String(err?.message || err))); }} disabled={s !== "on_trip"} title={s !== "on_trip" ? "Allowed only when status=on_trip" : "Complete trip"}>Drop off</button>
                            <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" onClick={(e) => { e.stopPropagation(); setSelectedTripId(id); setFilterAndFocus("problem"); }} title="Focus Problem trips view">Find problem</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="p-3 border-t">
            <div className="text-xs text-gray-600 mb-2">Drivers: {driversDebug}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <TripWalletPanel trip={selectedTrip as any} />
              <TripLifecycleActions trip={selectedTrip as any} />
            </div>

            <div className="mt-3 rounded border p-3">
              <div className="font-semibold mb-2">Assign driver (manual)</div>
              <div className="flex flex-wrap gap-2 items-center">
                <select className="border rounded px-2 py-1 text-sm min-w-[320px]" value={manualDriverId} onChange={(e) => setManualDriverId(e.target.value)}>
                  <option value="">Select driver</option>
                  {drivers.map((d, idx) => {
                    const id = String(d.driver_id || "");
                    const label = ((d.name || "Driver") + (d.town ? (" - " + d.town) : "") + (d.status ? (" - " + d.status) : "")).trim();
                    return <option key={id || idx} value={id}>{label}</option>;
                  })}
                </select>

                <button className="rounded bg-black text-white px-3 py-2 text-sm disabled:opacity-50" disabled={!selectedTrip?.booking_code || !manualDriverId} onClick={() => { if (!selectedTrip?.booking_code) return; assignDriver(selectedTrip.booking_code, manualDriverId).catch((err) => setLastAction(String(err?.message || err))); }}>Assign</button>
                <button className="rounded border px-3 py-2 text-sm hover:bg-gray-50" onClick={() => { loadPage().catch(() => {}); loadDrivers().catch(() => {}); setLastAction("Refreshed"); }}>Refresh now</button>
              </div>

              <div className="mt-2">
                <SmartAutoAssignSuggestions trip={selectedTrip as any} drivers={drivers as any} />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border overflow-hidden">
          <LiveTripsMap trips={visibleTrips as any} selectedTripId={selectedTripId} stuckTripIds={stuckTripIds as any} />
        </div>
      </div>
    </div>
  );
}
'@

$smartText = @'
"use client";

import React, { useMemo } from "react";

type Driver = {
  id?: string | null;
  driver_id?: string | null;
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
  zone?: string | null;
  town?: string | null;
  homeTown?: string | null;
  status?: string | null;
};

type Trip = {
  id?: string | null;
  booking_code?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  zone?: string | null;
  town?: string | null;
  tripType?: string | null;
  trip_type?: string | null;
};

type ZoneStat = {
  util?: number;
  status?: string;
};

type Props = {
  drivers?: Driver[];
  trip?: Trip | null;
  zoneStats?: Record<string, ZoneStat>;
  onAssign?: (driverId: string) => void | Promise<void>;
  assignedDriverId?: string | null;
  assigningDriverId?: string | null;
  canAssign?: boolean;
  lockReason?: string;
};

function isDeliveryType(tripType: string) {
  const t = (tripType || "").toLowerCase();
  return t.includes("food") || t.includes("delivery") || t.includes("takeout") || t.includes("errand");
}

function isDriverAvailable(status: string) {
  const s = (status || "").toLowerCase();
  if (!s) return true;
  return s.includes("available") || s.includes("online") || s.includes("idle") || s.includes("waiting");
}

export default function SmartAutoAssignSuggestions({
  drivers = [],
  trip = null,
  zoneStats = {},
  onAssign,
  assignedDriverId,
  assigningDriverId,
  canAssign = true,
  lockReason,
}: Props) {
  const suggestions = useMemo(() => {
    if (!trip) return [] as any[];

    const tripType = String(trip.tripType || trip.trip_type || "");
    const tripZone = String(trip.zone || trip.town || "");
    const pickupLat = Number(trip.pickupLat ?? trip.pickup_lat);
    const pickupLng = Number(trip.pickupLng ?? trip.pickup_lng);
    const deliveryMode = isDeliveryType(tripType);

    return drivers
      .filter((d) => {
        if (!isDriverAvailable(String(d.status || ""))) return false;
        const zKey = String(d.zone || d.town || d.homeTown || "Unknown");
        const zStat = zoneStats[zKey];
        if (zStat && zStat.status === "FULL") return false;
        if (!deliveryMode) return String(d.homeTown || d.town || d.zone || "") === tripZone;
        return true;
      })
      .map((d) => {
        const dLat = Number(d.lat);
        const dLng = Number(d.lng);
        const dist = Number.isFinite(dLat) && Number.isFinite(dLng) && Number.isFinite(pickupLat) && Number.isFinite(pickupLng)
          ? Math.sqrt(Math.pow(dLat - pickupLat, 2) + Math.pow(dLng - pickupLng, 2))
          : 999999;

        let score = dist;
        let label = "Nearest";
        const homeTown = String(d.homeTown || d.town || d.zone || "");
        const zone = String(d.zone || d.town || homeTown || "");

        if (!deliveryMode && homeTown === tripZone) {
          score = score * 0.4;
          label = "Same town";
        } else if (deliveryMode && homeTown === tripZone) {
          label = "Same town";
        } else if ((zoneStats[zone] || {}).status === "OK") {
          score = score * 0.8;
          label = "Low-load zone";
        }

        return {
          id: String(d.id || d.driver_id || ""),
          name: String(d.name || "Driver"),
          homeTown,
          label,
          score,
        };
      })
      .filter((d) => !!d.id)
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);
  }, [drivers, trip, zoneStats]);

  if (!trip) {
    return <div className="text-[11px] text-slate-400">Select a trip to see assignment suggestions.</div>;
  }

  if (!suggestions.length) {
    const deliveryMode = isDeliveryType(String(trip.tripType || trip.trip_type || ""));
    const tripZone = String(trip.zone || trip.town || "");
    return (
      <div className="text-[11px] text-slate-400">
        {deliveryMode ? <>No available drivers found near this pickup point.</> : <>No eligible drivers from <span className="font-semibold">{tripZone}</span>.</>}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {!canAssign ? (
        <div className="mb-1 rounded border bg-slate-50 p-2 text-[11px] text-slate-600">
          Assignment locked. {lockReason ? <span className="font-semibold">{lockReason}</span> : null}
        </div>
      ) : null}

      {suggestions.map((d) => {
        const isAssigned = !!assignedDriverId && d.id === assignedDriverId;
        const isAssigning = !!assigningDriverId && d.id === assigningDriverId;
        const disabled = !canAssign || isAssigning || (!!assigningDriverId && assigningDriverId !== d.id) || !onAssign;
        const label = isAssigning ? "Assigning..." : isAssigned ? "Assigned" : assignedDriverId ? "Reassign" : "Assign";

        return (
          <div key={d.id} className="flex items-center justify-between rounded border bg-white px-2 py-1 text-xs">
            <div>
              <div className="font-semibold">{d.name}</div>
              <div className="text-[10px] text-slate-500">{d.homeTown || "Unknown"} - {d.label}</div>
            </div>
            <button
              className={["rounded px-2 py-1 text-[10px] font-semibold text-white", disabled ? "bg-slate-300 cursor-not-allowed" : isAssigned ? "bg-emerald-500" : "bg-emerald-600 hover:bg-emerald-700"].join(" ")}
              disabled={disabled}
              onClick={() => { if (onAssign) onAssign(d.id); }}
              title={assignedDriverId ? "One driver per trip. Clicking Assign will reassign this trip." : "Assign this trip to this driver."}
            >
              {label}
            </button>
          </div>
        );
      })}
    </div>
  );
}
'@

Write-Utf8NoBom -Path $clientPath -Text $clientText
Write-Utf8NoBom -Path $smartPath  -Text $smartText
Assert-Ascii -Path $clientPath
Assert-Ascii -Path $smartPath

Write-Host "[OK] Wrote: $clientPath"
Write-Host "[OK] Wrote: $smartPath"
Write-Host "[OK] ASCII-safe validation passed"
