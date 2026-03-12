param(
  [Parameter(Mandatory=$true)][string]$RepoRoot
)

$ErrorActionPreference = "Stop"

Write-Host "== PATCH JRIDE LIVETRIPS + LEGACY DISPATCH STATUS NORMALIZATION V1 (PS5-safe) ==" -ForegroundColor Cyan
Write-Host "RepoRoot: $RepoRoot"

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Backup-File([string]$FilePath, [string]$Tag) {
  if (-not (Test-Path -LiteralPath $FilePath)) {
    throw "Required file not found: $FilePath"
  }
  $bakDir = Join-Path $RepoRoot "_patch_bak"
  Ensure-Dir $bakDir
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $dest = Join-Path $bakDir ((Split-Path $FilePath -Leaf) + ".bak.$Tag.$stamp")
  Copy-Item -LiteralPath $FilePath -Destination $dest -Force
  Write-Host "[OK] Backup: $dest" -ForegroundColor Green
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
  Write-Host "[OK] Wrote: $Path" -ForegroundColor Green
}

function Replace-OrFail([string]$Content, [string]$OldValue, [string]$NewValue, [string]$Label) {
  if ($Content.Contains($OldValue)) {
    Write-Host "[OK] $Label" -ForegroundColor Green
    return $Content.Replace($OldValue, $NewValue)
  }
  throw "Patch anchor not found for: $Label"
}

$liveTripsClientPath = Join-Path $RepoRoot "app/admin/livetrips/LiveTripsClient.tsx"
$smartAssignPath     = Join-Path $RepoRoot "app/admin/livetrips/components/SmartAutoAssignSuggestions.tsx"
$liveTripsMapPath    = Join-Path $RepoRoot "app/admin/livetrips/components/LiveTripsMap.tsx"
$dispatchStatusPath  = Join-Path $RepoRoot "app/api/dispatch/status/route.ts"

Backup-File $liveTripsClientPath "LIVETRIPS_CLIENT_FIX_V1"
Backup-File $smartAssignPath "SMART_ASSIGN_FIX_V1"
Backup-File $liveTripsMapPath "LIVETRIPS_MAP_STATUS_FIX_V1"
Backup-File $dispatchStatusPath "DISPATCH_STATUS_LEGACY_FIX_V1"

$liveTripsClientContent = @'
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
  ride_type?: string | null;
};

type DriverRow = {
  driver_id?: string | null;
  name?: string | null;
  phone?: string | null;
  town?: string | null;
  zone?: string | null;
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

const STUCK_THRESHOLDS_MIN = {
  on_the_way: 15,
  on_trip: 25,
};

const STATUS_CHAIN = [
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
  "completed",
  "cancelled",
] as const;

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

function toSuggestionTrip(trip: TripRow | null) {
  if (!trip) return null;
  return {
    id: String(normTripId(trip)),
    pickupLat: Number(trip.pickup_lat ?? 0),
    pickupLng: Number(trip.pickup_lng ?? 0),
    zone: String(trip.zone ?? trip.town ?? "Unknown"),
    tripType: String(trip.ride_type ?? "ride"),
  };
}

function buildZoneStats(zones: ZoneRow[]): Record<string, { util: number; status: string }> {
  const out: Record<string, { util: number; status: string }> = {};
  for (const z of zones) {
    const label = String(z.zone_name || "Unknown");
    const active = Number(z.active_drivers ?? 0);
    const capacity = Number(z.capacity_limit ?? 0);
    const util = capacity > 0 ? active / capacity : 0;
    out[label] = { util, status: String(z.status ?? "OK") };
  }
  return out;
}

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
      status: normStatus(t.status ?? "assigned"),
      ride_type: (t as any).ride_type ?? (t as any).tripType ?? (t as any).service_type ?? "ride",
    }));

    setZones(z);
    setAllTrips(normalized);

    const ids = new Set(normalized.map(normTripId).filter(Boolean));
    if (selectedTripId && !ids.has(selectedTripId)) setSelectedTripId(null);
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
      } catch {}
    }

    setDrivers([]);
    setDriversDebug("No drivers loaded from known endpoints.");
  }

  useEffect(() => {
    loadPage().catch((e) => setLastAction("Trips load failed: " + (e?.message ?? "unknown")));
    loadDrivers().catch((e) => setDriversDebug("Drivers load failed: " + (e?.message ?? "unknown")));
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      loadPage().catch(() => {});
      loadDrivers().catch(() => {});
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
    const c: Record<string, number> = {
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
      problem: 0,
    };

    for (const t of allTrips) {
      const s = normStatus(t.status);
      if (STATUS_CHAIN.includes(s as any)) c[s] = (c[s] ?? 0) + 1;
      if (["assigned", "accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip"].includes(s)) c.dispatch++;
      if (computeIsProblem(t)) c.problem++;
    }
    return c as Record<FilterKey, number>;
  }, [allTrips]);

  const visibleTrips = useMemo(() => {
    let out: TripRow[] = [];
    if (tripFilter === "dispatch") {
      out = allTrips.filter((t) => ["assigned", "accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip"].includes(normStatus(t.status)));
    } else if (tripFilter === "problem") {
      out = allTrips.filter((t) => stuckTripIds.has(normTripId(t)));
    } else {
      out = allTrips.filter((t) => normStatus(t.status) === tripFilter);
    }

    out.sort((a, b) => {
      const ta = new Date(a.updated_at || a.created_at || 0 as any).getTime() || 0;
      const tb = new Date(b.updated_at || b.created_at || 0 as any).getTime() || 0;
      return tb - ta;
    });

    return out;
  }, [allTrips, tripFilter, stuckTripIds]);

  useEffect(() => {
    if (!visibleTrips.length) {
      setSelectedTripId(null);
      return;
    }
    const ids = new Set(visibleTrips.map(normTripId));
    if (!selectedTripId || !ids.has(selectedTripId)) setSelectedTripId(normTripId(visibleTrips[0]));
  }, [visibleTrips, selectedTripId]);

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
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function postJson(url: string, body: any) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j && (j.error || j.message)) || "REQUEST_FAILED");
    return j;
  }

  async function assignDriver(bookingCode: string, driverId: string) {
    if (!bookingCode || !driverId) return;
    setLastAction("Assigning driver...");
    await postJson("/api/dispatch/assign", { bookingCode, driverId });
    setLastAction("Driver assigned");
    await loadPage();
  }

  async function updateTripStatus(bookingCode: string, status: string) {
    if (!bookingCode || !status) return;
    setLastAction(`Updating status to ${status}...`);
    await postJson("/api/dispatch/status", { bookingCode, status });
    setLastAction(`Status updated to ${status}`);
    await loadPage();
  }

  const zoneStats = useMemo(() => buildZoneStats(zones), [zones]);
  const showThresholds = `Stuck watcher thresholds: on_the_way ≥ ${STUCK_THRESHOLDS_MIN.on_the_way} min, on_trip ≥ ${STUCK_THRESHOLDS_MIN.on_trip} min`;

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Live Trips</h1>
          <p className="text-sm text-gray-600">Monitor normalized trip flow and dispatch state.</p>
        </div>
        <div className="text-xs text-gray-600 text-right">
          <div className="font-medium">Stuck watcher thresholds</div>
          <div>on_the_way ≥ {STUCK_THRESHOLDS_MIN.on_the_way} min, on_trip ≥ {STUCK_THRESHOLDS_MIN.on_trip} min</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {(["dispatch", ...STATUS_CHAIN, "problem"] as const).map((key) => (
          <button
            key={key}
            className={[
              pillClass(tripFilter === key),
              key === "problem" && tripFilter !== "problem" ? "border-red-300 text-red-700 hover:bg-red-50" : "",
            ].join(" ")}
            onClick={() => setFilterAndFocus(key as FilterKey)}
            title={key === "problem" ? showThresholds : undefined}
          >
            {key.replaceAll("_", " ")} <span className="text-xs opacity-80">{counts[key as FilterKey] ?? 0}</span>
          </button>
        ))}
        <div className="ml-auto self-center text-xs text-gray-600">{lastAction || "\u00A0"}</div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {zones.map((z) => (
          <div key={z.zone_id} className="rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{z.zone_name}</div>
              <div className="text-xs text-gray-600">{z.status || "—"}</div>
            </div>
            <div className="text-xs text-gray-600">Active: {z.active_drivers ?? 0} / Limit: {z.capacity_limit ?? "—"}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2" ref={tableRef}>
        <div className="rounded-lg border">
          <div className="flex items-center justify-between border-b p-3">
            <div className="font-semibold">{tripFilter === "dispatch" ? "Dispatch view (normalized lifecycle)" : "Trips"}</div>
            <div className="text-xs text-gray-600">{visibleTrips.length} shown</div>
          </div>

          <div className="overflow-auto" style={{ maxHeight: 520 }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b bg-white">
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
                      <tr key={id} className={["cursor-pointer border-b", isSel ? "bg-blue-50" : "hover:bg-gray-50"].join(" ")} onClick={() => setSelectedTripId(id)}>
                        <td className="p-2 font-medium">
                          {t.booking_code || "—"}
                          {isProblem ? <span className="ml-2 inline-flex rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-700">PROBLEM</span> : null}
                        </td>
                        <td className="p-2">{t.passenger_name || "—"}</td>
                        <td className="p-2">{t.pickup_label || "—"}</td>
                        <td className="p-2">{t.dropoff_label || "—"}</td>
                        <td className="p-2"><span className="inline-flex rounded-full border px-2 py-0.5 text-xs">{s || "—"}</span></td>
                        <td className="p-2">{t.zone || t.town || "—"}</td>
                        <td className="p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" onClick={(e) => { e.stopPropagation(); if (t.booking_code) updateTripStatus(t.booking_code, "on_the_way").catch((err) => setLastAction(String(err?.message || err))); }} disabled={s !== "ready"}>
                              On the way
                            </button>
                            <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" onClick={(e) => { e.stopPropagation(); if (t.booking_code) updateTripStatus(t.booking_code, "arrived").catch((err) => setLastAction(String(err?.message || err))); }} disabled={s !== "on_the_way"}>
                              Arrived
                            </button>
                            <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" onClick={(e) => { e.stopPropagation(); if (t.booking_code) updateTripStatus(t.booking_code, "on_trip").catch((err) => setLastAction(String(err?.message || err))); }} disabled={s !== "arrived"}>
                              Start trip
                            </button>
                            <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" onClick={(e) => { e.stopPropagation(); if (t.booking_code) updateTripStatus(t.booking_code, "completed").catch((err) => setLastAction(String(err?.message || err))); }} disabled={s !== "on_trip"}>
                              Complete
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

          <div className="border-t p-3">
            <div className="mb-2 text-xs text-gray-600">Drivers: {driversDebug}</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <TripWalletPanel trip={selectedTrip as any} />
              <TripLifecycleActions trip={selectedTrip as any} />
            </div>

            <div className="mt-3 rounded border p-3">
              <div className="mb-2 font-semibold">Assign driver (manual)</div>
              <div className="flex flex-wrap items-center gap-2">
                <select className="min-w-[320px] rounded border px-2 py-1 text-sm" value={manualDriverId} onChange={(e) => setManualDriverId(e.target.value)}>
                  <option value="">Select driver</option>
                  {drivers.map((d, idx) => {
                    const id = String(d.driver_id || "");
                    const label = `${d.name || "Driver"}${d.town ? ` — ${d.town}` : ""}${d.status ? ` — ${d.status}` : ""}`;
                    return <option key={id || idx} value={id}>{label}</option>;
                  })}
                </select>
                <button className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50" disabled={!selectedTrip?.booking_code || !manualDriverId} onClick={() => selectedTrip?.booking_code && assignDriver(selectedTrip.booking_code, manualDriverId).catch((err) => setLastAction(String(err?.message || err)))}>
                  Assign
                </button>
                <button className="rounded border px-3 py-2 text-sm hover:bg-gray-50" onClick={() => { loadPage().catch(() => {}); loadDrivers().catch(() => {}); setLastAction("Refreshed"); }}>
                  Refresh now
                </button>
              </div>

              <div className="mt-2">
                <SmartAutoAssignSuggestions
                  trip={toSuggestionTrip(selectedTrip)}
                  drivers={drivers.map((d) => ({
                    id: String(d.driver_id || ""),
                    name: String(d.name || "Driver"),
                    lat: Number(d.lat ?? 0),
                    lng: Number(d.lng ?? 0),
                    zone: String(d.zone ?? d.town ?? "Unknown"),
                    homeTown: String(d.town ?? d.zone ?? "Unknown"),
                    status: String(d.status ?? ""),
                  }))}
                  zoneStats={zoneStats}
                  onAssign={async (driverId) => {
                    if (!selectedTrip?.booking_code) throw new Error("NO_SELECTED_TRIP");
                    await assignDriver(String(selectedTrip.booking_code), driverId);
                  }}
                  assignedDriverId={selectedTrip?.driver_id ?? null}
                  canAssign={normStatus(selectedTrip?.status) === "assigned"}
                  lockReason={normStatus(selectedTrip?.status) !== "assigned" ? "Only assigned trips can be manually assigned here." : undefined}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <LiveTripsMap trips={visibleTrips as any} selectedTripId={selectedTripId} stuckTripIds={stuckTripIds as any} />
        </div>
      </div>
    </div>
  );
}

'@

$smartAssignContent = @'
"use client";

import React, { useMemo } from "react";

type Driver = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  zone: string;
  homeTown: string;
  status: string;
};

type Trip = {
  id: string;
  pickupLat: number;
  pickupLng: number;
  zone: string;
  tripType: string;
};

type ZoneStat = {
  util: number;
  status: string;
};

type Props = {
  drivers: Driver[];
  trip: Trip | null;
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
  return s.includes("available") || s.includes("online") || s.includes("idle") || s.includes("waiting");
}

export default function SmartAutoAssignSuggestions({
  drivers,
  trip,
  zoneStats = {},
  onAssign,
  assignedDriverId,
  assigningDriverId,
  canAssign = true,
  lockReason,
}: Props) {
  const suggestions = useMemo(() => {
    if (!trip) return [];
    const deliveryMode = isDeliveryType(trip.tripType);

    return drivers
      .filter((d) => {
        if (!d.id) return false;
        if (!Number.isFinite(d.lat) || !Number.isFinite(d.lng)) return false;
        if (!isDriverAvailable(d.status)) return false;
        const zKey = String(d.zone || d.homeTown || "Unknown");
        const zStat = zoneStats[zKey];
        if (zStat?.status === "FULL") return false;
        if (!deliveryMode) return d.homeTown === trip.zone;
        return true;
      })
      .map((d) => {
        const dist = Math.sqrt(Math.pow(d.lat - trip.pickupLat, 2) + Math.pow(d.lng - trip.pickupLng, 2));
        let score = dist;
        let label = "Nearest";

        if (!deliveryMode && d.homeTown === trip.zone) {
          score *= 0.4;
          label = "Same town (ordinance)";
        } else if (deliveryMode && d.homeTown === trip.zone) {
          label = "Same town";
        } else if (zoneStats[d.zone]?.status === "OK") {
          score *= 0.8;
          label = "Low-load zone";
        }

        return { ...d, score, label };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);
  }, [drivers, trip, zoneStats]);

  if (!trip) return <div className="text-[11px] text-slate-400">Select a trip to see assignment suggestions.</div>;
  if (!suggestions.length) return <div className="text-[11px] text-slate-400">No eligible drivers found for this trip.</div>;

  return (
    <div className="space-y-1">
      {!canAssign ? <div className="mb-1 rounded border bg-slate-50 p-2 text-[11px] text-slate-600">Assignment locked. {lockReason || ""}</div> : null}
      {suggestions.map((d) => {
        const isAssigned = !!assignedDriverId && d.id === assignedDriverId;
        const isAssigning = !!assigningDriverId && d.id === assigningDriverId;
        const disabled = !canAssign || !onAssign || isAssigning || (!!assigningDriverId && assigningDriverId !== d.id);
        const label = isAssigning ? "Assigning..." : isAssigned ? "Assigned" : assignedDriverId ? "Reassign" : "Assign";
        return (
          <div key={d.id} className="flex items-center justify-between rounded border bg-white px-2 py-1 text-xs">
            <div>
              <div className="font-semibold">{d.name}</div>
              <div className="text-[10px] text-slate-500">{d.homeTown} • {d.label}</div>
            </div>
            <button
              className={["rounded px-2 py-1 text-[10px] font-semibold text-white", disabled ? "cursor-not-allowed bg-slate-300" : isAssigned ? "bg-emerald-500" : "bg-emerald-600 hover:bg-emerald-700"].join(" ")}
              disabled={disabled}
              onClick={() => onAssign?.(d.id)}
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

$dispatchStatusContent = @'
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Body = {
  bookingId?: string | null;
  bookingCode?: string | null;
  status?: string | null;
  base_fare?: number | null;
  convenience_fee?: number | null;
  proposed_fare?: number | null;
};

const ALLOWED = new Set([
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
  "completed",
  "cancelled",
]);

function normalizeStatus(raw: string) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "driver_accepted") return "accepted";
  if (s === "awaiting_passenger_confirmation") return "fare_proposed";
  return s;
}

function driverStatusForBookingStatus(s: string) {
  if (s === "completed" || s === "cancelled") return "online";
  if (["assigned", "accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip"].includes(s)) return "on_trip";
  return null;
}

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as Body;

    const bookingId = String(body.bookingId ?? "").trim();
    const bookingCode = String(body.bookingCode ?? "").trim();
    const status = normalizeStatus(String(body.status ?? ""));
    const legacyFare = Number(body.base_fare ?? 0) + Number(body.convenience_fee ?? 0);
    const proposedFare = Number(body.proposed_fare ?? 0) || legacyFare || null;

    if (!status) return NextResponse.json({ error: "MISSING_STATUS" }, { status: 400 });
    if (!bookingId && !bookingCode) return NextResponse.json({ error: "MISSING_BOOKING_IDENTIFIER" }, { status: 400 });
    if (!ALLOWED.has(status)) return NextResponse.json({ error: "INVALID_STATUS", statusValue: status }, { status: 400 });

    let sel = supabase.from("bookings").select("id, booking_code, status, driver_id").limit(1);
    sel = bookingId ? sel.eq("id", bookingId) : sel.eq("booking_code", bookingCode);

    const { data: rows, error: selErr } = await sel;
    if (selErr) return NextResponse.json({ error: "DISPATCH_STATUS_SELECT_ERROR", message: selErr.message }, { status: 500 });

    const booking = rows?.[0];
    if (!booking?.id) return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });

    const updateBody: Record<string, any> = { status, updated_at: new Date().toISOString() };

    if (status === "fare_proposed" && proposedFare != null) {
      updateBody.proposed_fare = proposedFare;
    }

    const { error: upErr } = await supabase.from("bookings").update(updateBody).eq("id", booking.id);
    if (upErr) return NextResponse.json({ error: "DISPATCH_STATUS_DB_ERROR", message: upErr.message }, { status: 500 });

    const driverId = booking.driver_id ? String(booking.driver_id) : "";
    const mapped = driverStatusForBookingStatus(status);
    if (driverId && mapped) {
      await supabase.from("driver_locations").update({ status: mapped, updated_at: new Date().toISOString() }).eq("driver_id", driverId);
    }

    return NextResponse.json({ ok: true, status, legacy: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: "DISPATCH_STATUS_UNEXPECTED", message: err?.message ?? "Unexpected error" }, { status: 500 });
  }
}

'@

Write-Utf8NoBom $liveTripsClientPath $liveTripsClientContent
Write-Utf8NoBom $smartAssignPath $smartAssignContent
Write-Utf8NoBom $dispatchStatusPath $dispatchStatusContent

$map = Get-Content -LiteralPath $liveTripsMapPath -Raw
$mapOriginal = $map

$map = Replace-OrFail $map '["pending", "assigned", "on_the_way", "on_trip"]' '["assigned", "accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip"]' 'Map KPI active states normalized'
$map = Replace-OrFail $map '["pending", "assigned"]' '["assigned", "accepted", "fare_proposed", "ready"]' 'Map pending bucket normalized'
$map = Replace-OrFail $map 'const pending = trips.filter((t: any) => ["pending", "assigned"].includes((t.status ?? "").toString()));' 'const pending = trips.filter((t: any) => ["assigned", "accepted", "fare_proposed", "ready"].includes(String(t.status ?? "").toLowerCase()));' 'Map auto suggestion source trips normalized'
$map = Replace-OrFail $map 'String(t.id ?? t.bookingCode ?? "")' 'String(t.id ?? t.booking_code ?? t.bookingCode ?? "")' 'Map selected trip id fallback normalized'
$map = Replace-OrFail $map 'pending trips' 'dispatch queue' 'Dispatcher copy label normalized'

if ($map -eq $mapOriginal) {
  throw "LiveTripsMap.tsx was not changed."
}

Write-Utf8NoBom $liveTripsMapPath $map

Write-Host "`nPATCH COMPLETE." -ForegroundColor Cyan
Write-Host "Files updated:" -ForegroundColor Cyan
Write-Host " - $liveTripsClientPath"
Write-Host " - $smartAssignPath"
Write-Host " - $liveTripsMapPath"
Write-Host " - $dispatchStatusPath"
