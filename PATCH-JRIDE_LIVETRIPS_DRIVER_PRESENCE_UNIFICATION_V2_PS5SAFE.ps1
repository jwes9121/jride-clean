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

function Replace-Exact {
  param(
    [string]$Text,
    [string]$OldValue,
    [string]$NewValue,
    [string]$Label
  )
  if ($Text.IndexOf($OldValue) -lt 0) { throw "Missing expected block: $Label" }
  return $Text.Replace($OldValue, $NewValue)
}

function Replace-RegexOnce {
  param(
    [string]$Text,
    [string]$Pattern,
    [string]$Replacement,
    [string]$Label
  )
  $rx = New-Object System.Text.RegularExpressions.Regex($Pattern, ([System.Text.RegularExpressions.RegexOptions]::Singleline))
  if (-not $rx.IsMatch($Text)) { throw "Missing expected regex block: $Label" }
  return $rx.Replace($Text, $Replacement, 1)
}

$clientPath = Join-Path $WebRoot 'app\admin\livetrips\LiveTripsClient.tsx'
$mapPath = Join-Path $WebRoot 'app\admin\livetrips\components\LiveTripsMap.tsx'
$suggestPath = Join-Path $WebRoot 'app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx'

foreach ($p in @($clientPath,$mapPath,$suggestPath)) {
  if (!(Test-Path $p)) { throw "Target file not found: $p" }
}

Backup-File -Path $clientPath -Tag 'LIVETRIPS_DRIVER_PRESENCE_CLIENT_V2'
Backup-File -Path $mapPath -Tag 'LIVETRIPS_DRIVER_PRESENCE_MAP_V2'
Backup-File -Path $suggestPath -Tag 'LIVETRIPS_DRIVER_PRESENCE_SUGGEST_V2'

# =========================
# LiveTripsClient.tsx
# =========================
$client = Read-Utf8NoBom $clientPath

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
$client = Replace-Exact -Text $client -OldValue $oldDriverType -NewValue $newDriverType -Label 'DriverRow type'

$oldParseTrips = @'
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

$newParseTrips = @'
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
  const status =
    String(raw?.effective_status ?? raw?.status ?? raw?.driver_status_master ?? "")
      .trim()
      .toLowerCase() || null;
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
$client = Replace-Exact -Text $client -OldValue $oldParseTrips -NewValue $newParseTrips -Label 'parseTripsFromPageData block'

$client = Replace-RegexOnce -Text $client -Pattern 'async function loadDrivers\(\) \{[\s\S]*?\n  \}\n\n  useEffect\(\(\) => \{' -Replacement @'
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
      }
    }

    setDrivers([]);
    setDriversDebug("No drivers loaded from admin driver_locations endpoints.");
  }

  useEffect(() => {
'@ -Label 'loadDrivers function'

$client = Replace-Exact -Text $client -OldValue '  const selectedTrip = useMemo(() => {' -NewValue @'
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
        status = cap > 0 && active >= cap ? "FULL" : cap > 0 && active >= Math.max(1, Math.floor(cap * 0.8)) ? "WARN" : "OK";
      }
      out[key] = { util, status };
    }
    return out;
  }, [zones]);

  const selectedTrip = useMemo(() => {
'@ -Label 'selectedTrip anchor'

$client = Replace-RegexOnce -Text $client -Pattern '<SmartAutoAssignSuggestions\s+trip=\{selectedTrip as any\}\s+drivers=\{drivers as any\}\s*/>' -Replacement '<SmartAutoAssignSuggestions trip={selectedTrip as any} drivers={drivers as any} zoneStats={zoneStatsByKey as any} onAssign={(driverId) => selectedTrip?.booking_code ? assignDriver(selectedTrip.booking_code, String(driverId)) : Promise.resolve()} assignedDriverId={selectedTrip?.driver_id ?? null} />' -Label 'suggestions call'

$client = Replace-RegexOnce -Text $client -Pattern '<LiveTripsMap\s+trips=\{visibleTrips as any\}\s+selectedTripId=\{selectedTripId\}\s+stuckTripIds=\{stuckTripIds as any\}\s*/>' -Replacement '<LiveTripsMap trips={visibleTrips as any} drivers={drivers as any} selectedTripId={selectedTripId} stuckTripIds={stuckTripIds as any} />' -Label 'map call'

Write-Utf8NoBom -Path $clientPath -Content $client

# =========================
# LiveTripsMap.tsx
# =========================
$map = Read-Utf8NoBom $mapPath

$map = Replace-Exact -Text $map -OldValue @'
export interface LiveTripsMapProps {
  trips: LiveTrip[];
  selectedTripId: string | null;
  stuckTripIds: Set<string>; // external optional stuck set
}
'@ -NewValue @'
export interface LiveTripsMapProps {
  trips: LiveTrip[];
  drivers?: any[];
  selectedTripId: string | null;
  stuckTripIds: Set<string>; // external optional stuck set
}
'@ -Label 'LiveTripsMapProps'

$map = Replace-Exact -Text $map -OldValue @'
export const LiveTripsMap: React.FC<LiveTripsMapProps> = ({
  trips,
  selectedTripId,
  stuckTripIds,
}) => {
'@ -NewValue @'
export const LiveTripsMap: React.FC<LiveTripsMapProps> = ({
  trips,
  drivers = [],
  selectedTripId,
  stuckTripIds,
}) => {
'@ -Label 'LiveTripsMap component signature'

$map = Replace-Exact -Text $map -OldValue @'
    const drivers = trips.filter((t: any) =>
      ["idle", "available", "on_the_way", "on_trip"].includes(
        (t.status ?? "").toString()
      )
    );
'@ -NewValue @'
    const driverRows = Array.isArray(drivers) ? drivers : [];

    const driversForSuggestions = driverRows
      .filter((d: any) => {
        const status = String(d?.effective_status ?? d?.status ?? "").toLowerCase();
        if (!["online", "available", "idle", "waiting"].includes(status)) return false;
        if (d?.assign_eligible === false) return false;
        const lat = num(d?.lat ?? d?.latitude ?? d?.driver_lat);
        const lng = num(d?.lng ?? d?.longitude ?? d?.driver_lng);
        return lat != null && lng != null;
      })
      .map((d: any) => ({
        ...d,
        driver_name: d?.name ?? d?.driver_name ?? null,
        driver_id: d?.driver_id ?? d?.id ?? null,
        town: d?.town ?? d?.home_town ?? d?.zone ?? null,
        driver_lat: num(d?.lat ?? d?.latitude ?? d?.driver_lat),
        driver_lng: num(d?.lng ?? d?.longitude ?? d?.driver_lng),
      }));
'@ -Label 'map suggestions driver source'

$map = Replace-Exact -Text $map -OldValue '      for (const d of drivers as any[]) {' -NewValue '      for (const d of driversForSuggestions as any[]) {' -Label 'suggestions driver loop'

$map = Replace-Exact -Text $map -OldValue @'
    const nextDrivers: Record<string, mapboxgl.Marker> = {};
    const nextPickups: Record<string, mapboxgl.Marker> = {};
    const nextDrops: Record<string, mapboxgl.Marker> = {};
    const validRouteIds = new Set<string>();
'@ -NewValue @'
    const nextDrivers: Record<string, mapboxgl.Marker> = {};
    const nextPickups: Record<string, mapboxgl.Marker> = {};
    const nextDrops: Record<string, mapboxgl.Marker> = {};
    const validRouteIds = new Set<string>();

    const driverRows = Array.isArray(drivers) ? drivers : [];
    for (const rawDriver of driverRows as any[]) {
      const driverId = String(rawDriver?.driver_id ?? rawDriver?.id ?? "").trim();
      if (!driverId) continue;

      const lat = num(rawDriver?.lat ?? rawDriver?.latitude ?? rawDriver?.driver_lat);
      const lng = num(rawDriver?.lng ?? rawDriver?.longitude ?? rawDriver?.driver_lng);
      if (lat == null || lng == null) continue;

      const effectiveStatus = String(rawDriver?.effective_status ?? rawDriver?.status ?? "").toLowerCase();
      const isLive =
        effectiveStatus === "online" ||
        effectiveStatus === "available" ||
        effectiveStatus === "idle" ||
        effectiveStatus === "waiting";

      let marker = driverMarkersRef.current[`driver:${driverId}`];
      if (!marker) {
        const el = document.createElement("img");
        el.src = "/icons/jride-trike.png";
        el.style.width = "34px";
        el.style.height = "34px";
        el.style.transform = "translate(-50%, -50%)";
        el.style.opacity = isLive ? "1" : "0.45";
        marker = new mapboxgl.Marker(el).setLngLat([lng, lat]).addTo(map);
      } else {
        marker.setLngLat([lng, lat]);
        const el = marker.getElement() as HTMLElement;
        el.style.opacity = isLive ? "1" : "0.45";
      }
      nextDrivers[`driver:${driverId}`] = marker;
    }
'@ -Label 'driver markers source'

$map = $map.Replace('  }, [trips]);', '  }, [trips, drivers]);')
$map = $map.Replace('  }, [visibleTrips, activeStuckIds, mapReady]);', '  }, [visibleTrips, drivers, activeStuckIds, mapReady]);')

Write-Utf8NoBom -Path $mapPath -Content $map

# =========================
# SmartAutoAssignSuggestions.tsx
# =========================
$suggest = Read-Utf8NoBom $suggestPath

$suggest = Replace-Exact -Text $suggest -OldValue @'
type Driver = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  zone: string;
  homeTown: string;
  status: string;
};
'@ -NewValue @'
type Driver = {
  id?: string | null;
  driver_id?: string | null;
  name?: string | null;
  driver_name?: string | null;
  lat?: number | null;
  lng?: number | null;
  zone?: string | null;
  town?: string | null;
  homeTown?: string | null;
  home_town?: string | null;
  status?: string | null;
  effective_status?: string | null;
  assign_eligible?: boolean | null;
};
'@ -Label 'suggest Driver type'

$suggest = Replace-Exact -Text $suggest -OldValue @'
type Props = {
  drivers: Driver[];
  trip: Trip | null;
  zoneStats: Record<string, ZoneStat>;
  onAssign: (driverId: string) => void | Promise<void>;
'@ -NewValue @'
type Props = {
  drivers: Driver[];
  trip: Trip | null;
  zoneStats?: Record<string, ZoneStat>;
  onAssign?: (driverId: string) => void | Promise<void>;
'@ -Label 'suggest Props head'

$suggest = Replace-Exact -Text $suggest -OldValue @'
        if (!isDriverAvailable(d.status)) return false;
  const zKey = String((d as any)?.zone || (d as any)?.town || "Unknown");
  const zStat = (zoneStats || ({} as any))[zKey];
        if (zStat && zStat.status === "FULL") return false;
'@ -NewValue @'
        const status = String(d.effective_status ?? d.status ?? "");
        if (!isDriverAvailable(status)) return false;
        if (d.assign_eligible === false) return false;
        const zKey = String((d as any)?.zone || (d as any)?.town || (d as any)?.home_town || (d as any)?.homeTown || "Unknown");
        const zStat = (zoneStats || ({} as any))[zKey];
        if (zStat && zStat.status === "FULL") return false;
'@ -Label 'suggest availability filter'

$suggest = Replace-Exact -Text $suggest -OldValue @'
        if (!deliveryMode) return d.homeTown === trip.zone;
        return true;
'@ -NewValue @'
        const homeTown = String(d.homeTown ?? d.home_town ?? d.town ?? d.zone ?? "");
        if (!deliveryMode) return homeTown === trip.zone;
        return true;
'@ -Label 'suggest town rule'

$suggest = Replace-Exact -Text $suggest -OldValue '          Math.pow(d.lat - trip.pickupLat, 2) + Math.pow(d.lng - trip.pickupLng, 2)' -NewValue '          Math.pow(Number(d.lat ?? 0) - trip.pickupLat, 2) + Math.pow(Number(d.lng ?? 0) - trip.pickupLng, 2)' -Label 'suggest distance math'

$suggest = Replace-Exact -Text $suggest -OldValue @'
        if (!deliveryMode && d.homeTown === trip.zone) {
          score *= 0.4;
          label = "Same town (ordinance)";
        } else if (deliveryMode && d.homeTown === trip.zone) {
          label = "Same town";
        } else if (zoneStats[d.zone]?.status === "OK") {
'@ -NewValue @'
        const homeTown = String(d.homeTown ?? d.home_town ?? d.town ?? d.zone ?? "");
        const zoneKey = String(d.zone ?? d.town ?? d.home_town ?? d.homeTown ?? "");
        if (!deliveryMode && homeTown === trip.zone) {
          score *= 0.4;
          label = "Same town (ordinance)";
        } else if (deliveryMode && homeTown === trip.zone) {
          label = "Same town";
        } else if ((zoneStats || ({} as any))[zoneKey]?.status === "OK") {
'@ -Label 'suggest scoring rule'

$suggest = Replace-Exact -Text $suggest -OldValue '        return { ...d, score, label };' -NewValue @'
        return {
          ...d,
          id: String(d.id ?? d.driver_id ?? ""),
          name: String(d.name ?? d.driver_name ?? d.driver_id ?? "Driver"),
          homeTown,
          zone: zoneKey,
          score,
          label,
        };
'@ -Label 'suggest return shape'

$suggest = Replace-Exact -Text $suggest -OldValue @'
              <div className="font-semibold">{d.name}</div>
              <div className="text-[10px] text-slate-500">{d.homeTown} • {d.label}</div>
'@ -NewValue @'
              <div className="font-semibold">{d.name}</div>
              <div className="text-[10px] text-slate-500">{d.homeTown || d.zone || "Unknown"} • {d.label}</div>
'@ -Label 'suggest display text'

$suggest = Replace-Exact -Text $suggest -OldValue '              onClick={() => onAssign(d.id)}' -NewValue '              onClick={() => onAssign?.(String(d.id ?? ""))}' -Label 'suggest onAssign click'

Write-Utf8NoBom -Path $suggestPath -Content $suggest

Write-Host ""
Write-Host "DONE"
Write-Host "Next:"
Write-Host "1) npm run build"
Write-Host "2) Test one live booking flow"
Write-Host "3) Commit only:"
Write-Host "   app/admin/livetrips/LiveTripsClient.tsx"
Write-Host "   app/admin/livetrips/components/LiveTripsMap.tsx"
Write-Host "   app/admin/livetrips/components/SmartAutoAssignSuggestions.tsx"
