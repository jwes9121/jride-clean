param(
  [Parameter(Mandatory=$true)]
  [string]$WebRoot
)

$ErrorActionPreference = 'Stop'

function Backup-File {
  param([string]$Path,[string]$Tag)
  $dir = Split-Path -Parent $Path
  $bakDir = Join-Path $dir '_patch_bak'
  if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $dest = Join-Path $bakDir ((Split-Path -Leaf $Path) + '.bak.' + $Tag + '.' + $stamp)
  Copy-Item $Path $dest -Force
  Write-Host "[OK] Backup: $dest"
}

function Read-Utf8NoBom {
  param([string]$Path)
  $text = [System.IO.File]::ReadAllText($Path)
  if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
  return $text
}

function Write-Utf8NoBom {
  param([string]$Path,[string]$Content)
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $enc)
  Write-Host "[OK] Wrote: $Path"
}

function Assert-Contains {
  param([string]$Text,[string]$Needle,[string]$Label)
  if ($Text.IndexOf($Needle) -lt 0) { throw "Missing expected block: $Label" }
}

$clientPath = Join-Path $WebRoot 'app\admin\livetrips\LiveTripsClient.tsx'
$mapPath = Join-Path $WebRoot 'app\admin\livetrips\components\LiveTripsMap.tsx'
$suggestPath = Join-Path $WebRoot 'app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx'

foreach ($p in @($clientPath,$mapPath,$suggestPath)) {
  if (!(Test-Path $p)) { throw "Target file not found: $p" }
}

Backup-File -Path $clientPath -Tag 'LIVETRIPS_DRIVER_PRESENCE_CLIENT_V1'
Backup-File -Path $mapPath -Tag 'LIVETRIPS_DRIVER_PRESENCE_MAP_V1'
Backup-File -Path $suggestPath -Tag 'LIVETRIPS_DRIVER_PRESENCE_SUGGEST_V1'

# =========================
# LiveTripsClient.tsx
# =========================
$client = Read-Utf8NoBom $clientPath

Assert-Contains $client 'type DriverRow = {' 'DriverRow type'
Assert-Contains $client 'async function loadDrivers() {' 'loadDrivers function'
Assert-Contains $client '<SmartAutoAssignSuggestions trip={selectedTrip as any} drivers={drivers as any} />' 'old suggestions call'
Assert-Contains $client '<LiveTripsMap trips={visibleTrips as any} selectedTripId={selectedTripId} stuckTripIds={stuckTripIds as any} />' 'old map call'

$oldDriverType = @'
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
'@

$newDriverType = @'
type DriverRow = {
  id?: string | null;
  driver_id?: string | null;
  name?: string | null;
  phone?: string | null;
  town?: string | null;
  home_town?: string | null;
  zone?: string | null;
  status?: string | null;
  effective_status?: string | null;
  driver_status_master?: string | null;
  lat?: number | null;
  lng?: number | null;
  updated_at?: string | null;
  age_seconds?: number | null;
  is_stale?: boolean | null;
  assign_fresh?: boolean | null;
  assign_online_eligible?: boolean | null;
  assign_eligible?: boolean | null;
};
'@
$client = $client.Replace($oldDriverType, $newDriverType)

$anchor = @'
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
'@
Assert-Contains $client $anchor 'parseTripsFromPageData anchor'

$helpers = @'
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

function toNum(v: any): number | null {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

function normalizeDriverRow(raw: any): DriverRow {
  const status = String(raw?.effective_status ?? raw?.status ?? raw?.driver_status_master ?? "").trim().toLowerCase() || null;
  return {
    id: raw?.id ?? null,
    driver_id: raw?.driver_id ?? raw?.id ?? null,
    name: raw?.name ?? raw?.driver_name ?? raw?.full_name ?? null,
    phone: raw?.phone ?? raw?.driver_phone ?? null,
    town: raw?.town ?? raw?.home_town ?? raw?.zone ?? raw?.zone_name ?? raw?.toda_name ?? null,
    home_town: raw?.home_town ?? raw?.town ?? null,
    zone: raw?.zone ?? raw?.zone_name ?? raw?.town ?? raw?.home_town ?? null,
    status,
    effective_status: raw?.effective_status ?? status,
    driver_status_master: raw?.driver_status_master ?? raw?.driver_status ?? null,
    lat: toNum(raw?.lat ?? raw?.latitude ?? raw?.driver_lat),
    lng: toNum(raw?.lng ?? raw?.longitude ?? raw?.driver_lng),
    updated_at: raw?.updated_at ?? raw?.created_at ?? null,
    age_seconds: typeof raw?.age_seconds === "number" ? raw.age_seconds : toNum(raw?.age_seconds),
    is_stale: typeof raw?.is_stale === "boolean" ? raw.is_stale : null,
    assign_fresh: typeof raw?.assign_fresh === "boolean" ? raw.assign_fresh : null,
    assign_online_eligible: typeof raw?.assign_online_eligible === "boolean" ? raw.assign_online_eligible : null,
    assign_eligible: typeof raw?.assign_eligible === "boolean" ? raw.assign_eligible : null,
  };
}

function normalizeDriverRows(input: any): DriverRow[] {
  const arr = Array.isArray(input) ? input : [];
  return arr
    .map((row) => normalizeDriverRow(row))
    .filter((d) => String(d.driver_id ?? "").trim().length > 0);
}
'@
$client = $client.Replace($anchor, $helpers)

$loadDriversPattern = 'async function loadDrivers\(\) \{[\s\S]*?\n  \}\n\n  useEffect\(\(\) => \{'
if (-not [regex]::IsMatch($client, $loadDriversPattern)) { throw 'Could not match LiveTripsClient loadDrivers block' }
$loadDriversReplacement = @'
async function loadDrivers() {
    const endpoints = [
      "/api/admin/driver-locations",
      "/api/admin/driver_locations",
    ];

    for (const url of endpoints) {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) continue;
        const j = await r.json().catch(() => ({} as any));
        const arr = normalizeDriverRows(j?.drivers ?? j?.data ?? j);
        if (Array.isArray(arr) && arr.length) {
          setDrivers(arr);
          const eligible = arr.filter((d) => d.assign_eligible === true).length;
          setDriversDebug(`loaded from ${url} (${arr.length}) | eligible ${eligible}`);
          return;
        }
      } catch {
        // try next endpoint
      }
    }

    setDrivers([]);
    setDriversDebug("No drivers loaded from admin driver_locations endpoints.");
  }

  useEffect(() => {
'@
$client = [regex]::Replace($client, $loadDriversPattern, $loadDriversReplacement)

$zoneAnchor = '  const selectedTrip = useMemo(() => {'
Assert-Contains $client $zoneAnchor 'selectedTrip anchor'
$zoneInsert = @'
  const zoneStatsByKey = useMemo(() => {
    const out: Record<string, { util: number; status: string }> = {};
    for (const z of zones) {
      const key = String(z.zone_name ?? z.zone_id ?? "").trim();
      if (!key) continue;
      const active = Number(z.active_drivers ?? 0);
      const cap = Number(z.capacity_limit ?? 0);
      const util = cap > 0 ? active / cap : 0;
      let status = String(z.status ?? "").trim().toUpperCase();
      if (!status) {
        if (cap > 0 && active >= cap) status = "FULL";
        else if (util >= 0.85) status = "WARN";
        else status = "OK";
      }
      out[key] = { util, status };
    }
    return out;
  }, [zones]);

  const selectedTrip = useMemo(() => {
'@
$client = $client.Replace($zoneAnchor, $zoneInsert)

$client = $client.Replace('<SmartAutoAssignSuggestions trip={selectedTrip as any} drivers={drivers as any} />','<SmartAutoAssignSuggestions trip={selectedTrip as any} drivers={drivers as any} zoneStats={zoneStatsByKey as any} onAssign={(driverId) => { if (!selectedTrip?.booking_code) return; setManualDriverId(driverId); assignDriver(selectedTrip.booking_code, driverId).catch((err) => setLastAction(String(err?.message || err))); }} />')
$client = $client.Replace('<LiveTripsMap trips={visibleTrips as any} selectedTripId={selectedTripId} stuckTripIds={stuckTripIds as any} />','<LiveTripsMap trips={visibleTrips as any} drivers={drivers as any} selectedTripId={selectedTripId} stuckTripIds={stuckTripIds as any} />')

Write-Utf8NoBom $clientPath $client

# =========================
# SmartAutoAssignSuggestions.tsx (full replace)
# =========================
$suggest = @'
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
  home_town?: string | null;
  status?: string | null;
  effective_status?: string | null;
  assign_eligible?: boolean | null;
  is_stale?: boolean | null;
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
  util: number;
  status: string;
};

type Props = {
  drivers: Driver[];
  trip: Trip | null;
  zoneStats?: Record<string, ZoneStat>;
  onAssign?: (driverId: string) => void;
};

function num(v: any): number | null {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

function norm(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function isDeliveryType(trip: Trip | null) {
  const t = norm(trip?.trip_type ?? trip?.tripType);
  return t.includes("food") || t.includes("delivery") || t.includes("takeout") || t.includes("errand");
}

function driverId(d: Driver) {
  return String(d.driver_id ?? d.id ?? "").trim();
}

function driverTown(d: Driver) {
  return String(d.town ?? d.home_town ?? d.zone ?? "").trim();
}

function driverStatus(d: Driver) {
  return norm(d.effective_status ?? d.status);
}

function isDriverAvailable(d: Driver) {
  if (d.assign_eligible === true) return true;
  if (d.is_stale === true) return false;
  const s = driverStatus(d);
  return s === "online" || s === "available" || s === "idle" || s === "waiting";
}

function pickupLat(trip: Trip | null) {
  return num(trip?.pickup_lat ?? trip?.pickupLat);
}

function pickupLng(trip: Trip | null) {
  return num(trip?.pickup_lng ?? trip?.pickupLng);
}

export default function SmartAutoAssignSuggestions({
  drivers,
  trip,
  zoneStats = {},
  onAssign,
}: Props) {
  const suggestions = useMemo(() => {
    if (!trip) return [];

    const pLat = pickupLat(trip);
    const pLng = pickupLng(trip);
    if (pLat == null || pLng == null) return [];

    const tripZone = String(trip.zone ?? trip.town ?? "").trim();
    const deliveryMode = isDeliveryType(trip);

    return (Array.isArray(drivers) ? drivers : [])
      .filter((d) => {
        const id = driverId(d);
        if (!id) return false;
        if (!isDriverAvailable(d)) return false;

        const zKey = driverTown(d);
        const zStat = zKey ? zoneStats[zKey] : null;
        if (zStat && String(zStat.status).toUpperCase() === "FULL") return false;

        if (!deliveryMode && tripZone) {
          return driverTown(d) === tripZone;
        }

        return true;
      })
      .map((d) => {
        const lat = num(d.lat);
        const lng = num(d.lng);
        const dist = lat == null || lng == null
          ? Number.MAX_SAFE_INTEGER
          : Math.sqrt(Math.pow(lat - pLat, 2) + Math.pow(lng - pLng, 2));

        let score = dist;
        let label = "Nearest";
        if (!deliveryMode && tripZone && driverTown(d) === tripZone) {
          score = score * 0.4;
          label = "Same town";
        } else if (tripZone && driverTown(d) === tripZone) {
          label = "Same town";
        }

        return {
          ...d,
          score,
          label,
          resolvedId: driverId(d),
          resolvedTown: driverTown(d),
        };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);
  }, [drivers, trip, zoneStats]);

  if (!trip) {
    return <div className="text-[11px] text-slate-400">Select a trip to see assignment suggestions.</div>;
  }

  if (!suggestions.length) {
    return <div className="text-[11px] text-slate-400">No eligible drivers found from the authoritative driver presence feed.</div>;
  }

  return (
    <div className="space-y-1">
      {suggestions.map((d) => (
        <div key={d.resolvedId} className="flex items-center justify-between rounded border bg-white px-2 py-1 text-xs">
          <div>
            <div className="font-semibold">{d.name ?? "Driver"}</div>
            <div className="text-[10px] text-slate-500">{d.resolvedTown || "Unknown town"} · {d.label}</div>
          </div>
          <button
            className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            disabled={!onAssign}
            onClick={() => onAssign && onAssign(d.resolvedId)}
          >
            Assign
          </button>
        </div>
      ))}
    </div>
  );
}
'@
Write-Utf8NoBom $suggestPath $suggest

# =========================
# LiveTripsMap.tsx
# =========================
$map = Read-Utf8NoBom $mapPath
Assert-Contains $map 'export interface LiveTripsMapProps {' 'LiveTripsMapProps'
Assert-Contains $map 'export const LiveTripsMap: React.FC<LiveTripsMapProps> = ({' 'LiveTripsMap component'
Assert-Contains $map 'const selectedOverview = useMemo(() => {' 'selectedOverview block'

$map = $map.Replace('export interface LiveTripsMapProps {' + [Environment]::NewLine + '  trips: LiveTrip[];' + [Environment]::NewLine + '  selectedTripId: string | null;' + [Environment]::NewLine + '  stuckTripIds: Set<string>; // external optional stuck set' + [Environment]::NewLine + '}', 'export interface LiveTripsMapProps {' + [Environment]::NewLine + '  trips: LiveTrip[];' + [Environment]::NewLine + '  drivers?: any[];' + [Environment]::NewLine + '  selectedTripId: string | null;' + [Environment]::NewLine + '  stuckTripIds: Set<string>; // external optional stuck set' + [Environment]::NewLine + '}')

$map = $map.Replace('export const LiveTripsMap: React.FC<LiveTripsMapProps> = ({' + [Environment]::NewLine + '  trips,' + [Environment]::NewLine + '  selectedTripId,' + [Environment]::NewLine + '  stuckTripIds,' + [Environment]::NewLine + '}) => {', 'export const LiveTripsMap: React.FC<LiveTripsMapProps> = ({' + [Environment]::NewLine + '  trips,' + [Environment]::NewLine + '  drivers = [],' + [Environment]::NewLine + '  selectedTripId,' + [Environment]::NewLine + '  stuckTripIds,' + [Environment]::NewLine + '}) => {')

$mapHelpersAnchor = @'
function getDriverDisplay(real: LngLatTuple | null): LngLatTuple | null {
  if (!real) return null;
  const [lng, lat] = real;
  // ~20m south
  const offsetLat = lat - 0.00018;
  return [lng, offsetLat];
}
'@
Assert-Contains $map $mapHelpersAnchor 'driver display helper anchor'
$mapHelpersReplacement = @'
function getDriverDisplay(real: LngLatTuple | null): LngLatTuple | null {
  if (!real) return null;
  const [lng, lat] = real;
  // ~20m south
  const offsetLat = lat - 0.00018;
  return [lng, offsetLat];
}

function driverPresenceId(d: any): string {
  return String(d?.driver_id ?? d?.id ?? "").trim();
}

function driverPresenceCoord(d: any): LngLatTuple | null {
  const lat = num(d?.lat ?? d?.latitude ?? d?.driver_lat);
  const lng = num(d?.lng ?? d?.longitude ?? d?.driver_lng);
  if (lat == null || lng == null) return null;
  return [lng, lat];
}

function driverPresenceTown(d: any): string {
  return String(d?.town ?? d?.home_town ?? d?.zone ?? d?.zone_name ?? "").trim();
}

function driverPresenceStatus(d: any): string {
  return String(d?.effective_status ?? d?.status ?? d?.driver_status_master ?? "").trim().toLowerCase();
}

function isDriverPresenceVisible(d: any): boolean {
  if (!d) return false;
  if (d.assign_eligible === true) return true;
  if (d.is_stale === true) return false;
  const s = driverPresenceStatus(d);
  return ["online", "available", "idle", "waiting", "assigned", "on_the_way", "on_trip"].includes(s);
}

function findTripDriverPresence(trip: any, drivers: any[]): any | null {
  const selectedDriverId = String(trip?.driver_id ?? trip?.driverId ?? "").trim();
  if (selectedDriverId) {
    const byId = (drivers || []).find((d: any) => driverPresenceId(d) === selectedDriverId);
    if (byId) return byId;
  }

  const selectedDriverName = String(trip?.driver_name ?? trip?.driverName ?? "").trim().toLowerCase();
  if (selectedDriverName) {
    const byName = (drivers || []).find((d: any) => String(d?.name ?? d?.driver_name ?? "").trim().toLowerCase() === selectedDriverName);
    if (byName) return byName;
  }

  return null;
}
'@
$map = $map.Replace($mapHelpersAnchor, $mapHelpersReplacement)

$map = $map.Replace('        getDriverReal(raw) ?? getDropoff(raw) ?? getPickup(raw);','        getDriverReal(raw) ?? driverPresenceCoord(findTripDriverPresence(raw, drivers)) ?? getDropoff(raw) ?? getPickup(raw);')
$map = $map.Replace('        const driverReal = getDriverReal(d);','        const driverReal = driverPresenceCoord(d);')
$map = $map.Replace('    const driverReal = getDriverReal(selectedTrip);','    const driverReal = getDriverReal(selectedTrip) ?? driverPresenceCoord(selectedDriverPresence);')
$map = $map.Replace('      const driverReal = getDriverReal(raw);','      const driverReal = getDriverReal(raw) ?? driverPresenceCoord(findTripDriverPresence(raw, drivers));')
$map = $map.Replace('    const driverReal = getDriverReal(raw);','    const driverReal = getDriverReal(raw) ?? driverPresenceCoord(findTripDriverPresence(raw, drivers));')

$selectedTripAnchor = @'
  const selectedOverview = useMemo(() => {
    if (!selectedTrip) return null;
'@
Assert-Contains $map $selectedTripAnchor 'selectedOverview anchor'
$selectedTripReplacement = @'
  const selectedDriverPresence = useMemo(() => {
    if (!selectedTrip) return null;
    return findTripDriverPresence(selectedTrip, drivers);
  }, [selectedTrip, drivers]);

  const selectedOverview = useMemo(() => {
    if (!selectedTrip) return null;
'@
$map = $map.Replace($selectedTripAnchor, $selectedTripReplacement)

$selectedOverviewPattern = 'const selectedOverview = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[selectedTrip, activeStuckIds\]\);'
if (-not [regex]::IsMatch($map, $selectedOverviewPattern)) { throw 'Could not match selectedOverview block' }
$selectedOverviewReplacement = @'
const selectedOverview = useMemo(() => {
    if (!selectedTrip) return null;

    const id = String(selectedTrip.id ?? selectedTrip.bookingCode ?? "");
    const driverName =
      selectedDriverPresence?.name ??
      selectedTrip.driver_name ??
      selectedTrip.driverName ??
      null;
    const status = String(
      selectedDriverPresence?.effective_status ??
      selectedDriverPresence?.status ??
      selectedTrip.status ??
      ""
    );
    const zoneLabel = driverPresenceTown(selectedDriverPresence) || getZoneName(selectedTrip);
    const isStuck = activeStuckIds.has(id) || !!selectedTrip.isProblem;

    const driverReal = getDriverReal(selectedTrip) ?? driverPresenceCoord(selectedDriverPresence);
    const pickup = getPickup(selectedTrip);
    const drop = getDropoff(selectedTrip);

    let distToPickup: number | null = null;
    let distToDrop: number | null = null;
    if (driverReal && pickup) distToPickup = distanceMeters(driverReal, pickup);
    if (driverReal && drop) distToDrop = distanceMeters(driverReal, drop);

    const bookingCode = selectedTrip.bookingCode ?? id;
    const lastUpdate =
      selectedDriverPresence?.updated_at ??
      selectedTrip.driver_last_seen_at ??
      selectedTrip.updated_at ??
      selectedTrip.inserted_at ??
      null;

    return {
      id,
      driverName,
      status,
      zoneLabel,
      isStuck,
      distToPickup,
      distToDrop,
      bookingCode,
      lastUpdate,
    };
  }, [selectedTrip, selectedDriverPresence, activeStuckIds]);
'@
$map = [regex]::Replace($map, $selectedOverviewPattern, $selectedOverviewReplacement)

$markerEffectAnchor = '  // ===== AUTO-FOLLOW ====='
Assert-Contains $map $markerEffectAnchor 'auto-follow anchor'
$markerEffectInsert = @'
  const visibleDrivers = useMemo(() => {
    if (zoneFilter === "all") return drivers;
    return (drivers || []).filter((d: any) => normalizeZone(driverPresenceTown(d)) === zoneFilter);
  }, [drivers, zoneFilter]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const nextStandalone: Record<string, mapboxgl.Marker> = {};

    for (const raw of visibleDrivers as any[]) {
      const id = driverPresenceId(raw);
      if (!id) continue;
      if (!isDriverPresenceVisible(raw)) continue;

      const real = driverPresenceCoord(raw);
      if (!real) continue;

      let marker = standaloneDriverMarkersRef.current[id];
      if (!marker) {
        const el = document.createElement("div");
        el.style.width = "12px";
        el.style.height = "12px";
        el.style.borderRadius = "9999px";
        el.style.border = "2px solid #ffffff";
        el.style.boxShadow = "0 0 0 1px rgba(15,23,42,0.25)";
        marker = new mapboxgl.Marker(el).setLngLat(real).addTo(map);
      } else {
        marker.setLngLat(real);
      }

      const el2 = marker.getElement() as HTMLDivElement;
      const status = driverPresenceStatus(raw);
      const isEligible = raw?.assign_eligible === true;
      if (isEligible || status === "available" || status === "online" || status === "idle" || status === "waiting") {
        el2.style.backgroundColor = "#2563eb";
      } else {
        el2.style.backgroundColor = "#64748b";
      }
      el2.title = `${raw?.name ?? "Driver"} | ${status || "unknown"} | ${driverPresenceTown(raw) || "Unknown town"}`;
      nextStandalone[id] = marker;
    }

    for (const key of Object.keys(standaloneDriverMarkersRef.current)) {
      if (!nextStandalone[key]) {
        standaloneDriverMarkersRef.current[key].remove();
      }
    }

    standaloneDriverMarkersRef.current = nextStandalone;
  }, [visibleDrivers, mapReady]);

  // ===== AUTO-FOLLOW =====
'@
$map = $map.Replace($markerEffectAnchor, $markerEffectInsert)

$map = $map.Replace('  }, [trips]);','  }, [trips, drivers]);')

Write-Utf8NoBom $mapPath $map

Write-Host ''
Write-Host 'PATCH COMPLETE: authoritative driver presence feed is now wired into LiveTrips client, suggestions, and map.'
