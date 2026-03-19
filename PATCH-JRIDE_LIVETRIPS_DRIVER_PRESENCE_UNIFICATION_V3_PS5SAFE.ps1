param(
  [Parameter(Mandatory=$true)]
  [string]$WebRoot
)

$ErrorActionPreference = 'Stop'

function Backup-File {
  param(
    [string]$Path,
    [string]$Tag
  )
  $dir = Split-Path -Parent $Path
  $bakDir = Join-Path $dir '_patch_bak'
  if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Force -Path $bakDir | Out-Null }
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $bak = Join-Path $bakDir ((Split-Path $Path -Leaf) + ".bak.$Tag.$stamp")
  Copy-Item $Path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Read-Utf8 {
  param([string]$Path)
  return [System.IO.File]::ReadAllText($Path)
}

function Write-Utf8NoBom {
  param([string]$Path,[string]$Content)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

$clientPath = Join-Path $WebRoot 'app\admin\livetrips\LiveTripsClient.tsx'
$mapPath = Join-Path $WebRoot 'app\admin\livetrips\components\LiveTripsMap.tsx'

if (!(Test-Path $clientPath)) { throw "Target file not found: $clientPath" }
if (!(Test-Path $mapPath)) { throw "Target file not found: $mapPath" }

Backup-File -Path $clientPath -Tag 'LIVETRIPS_DRIVER_PRESENCE_CLIENT_V3'
Backup-File -Path $mapPath -Tag 'LIVETRIPS_DRIVER_PRESENCE_MAP_V3'

$client = Read-Utf8 $clientPath
$map = Read-Utf8 $mapPath

# ----------------------------
# LiveTripsClient.tsx patches
# ----------------------------

# 1) Strengthen DriverRow type without depending on exact formatting
if ($client -notmatch 'effective_status\?\s*:') {
  $client = [regex]::Replace(
    $client,
    'type\s+DriverRow\s*=\s*\{([\s\S]*?)\n\};',
    {
      param($m)
      $body = $m.Groups[1].Value
      if ($body -match 'effective_status\?\s*:') { return $m.Value }
      $inject = @"
$body
  effective_status?: string | null;
  age_seconds?: number | null;
  is_stale?: boolean | null;
  assign_fresh?: boolean | null;
  assign_online_eligible?: boolean | null;
  assign_eligible?: boolean | null;
  vehicle_type?: string | null;
  plate_number?: string | null;
"@
      return "type DriverRow = {${inject}`n};"
    },
    1
  )
}

# 2) Add driver normalizer helpers after safeArray if not already present
if ($client -notmatch 'function\s+normalizeDriverRows\s*\(') {
  $anchor = 'function safeArray<T>(v: any): T\[] \{[\s\S]*?\n\}'
  $insert = @"
function safeArray<T>(v: any): T[] {
  if (!v) return [];
  if (Array.isArray(v)) return v as T[];
  return [];
}

function normalizeDriverRows(rows: any[]): DriverRow[] {
  const out = safeArray<any>(rows)
    .map((raw) => {
      const driver_id = String(
        raw?.driver_id ?? raw?.id ?? raw?.uuid ?? raw?.user_id ?? ""
      ).trim() || null;

      const latRaw = raw?.lat ?? raw?.latitude ?? raw?.driver_lat ?? raw?.current_lat;
      const lngRaw = raw?.lng ?? raw?.longitude ?? raw?.driver_lng ?? raw?.current_lng;
      const lat = latRaw == null || latRaw === "" ? null : Number(latRaw);
      const lng = lngRaw == null || lngRaw === "" ? null : Number(lngRaw);

      const effective_status = raw?.effective_status ?? raw?.status ?? null;
      const status = raw?.status ?? raw?.effective_status ?? null;

      return {
        ...raw,
        driver_id,
        name: raw?.name ?? raw?.driver_name ?? raw?.full_name ?? null,
        phone: raw?.phone ?? raw?.mobile ?? null,
        town: raw?.town ?? raw?.zone ?? raw?.home_town ?? raw?.municipality ?? null,
        status,
        effective_status,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        updated_at: raw?.updated_at ?? raw?.last_seen_at ?? raw?.pinged_at ?? null,
        age_seconds: raw?.age_seconds == null ? null : Number(raw?.age_seconds),
        is_stale: typeof raw?.is_stale === "boolean" ? raw.is_stale : null,
        assign_fresh: typeof raw?.assign_fresh === "boolean" ? raw.assign_fresh : null,
        assign_online_eligible:
          typeof raw?.assign_online_eligible === "boolean" ? raw.assign_online_eligible : null,
        assign_eligible:
          typeof raw?.assign_eligible === "boolean" ? raw.assign_eligible : null,
        vehicle_type: raw?.vehicle_type ?? raw?.vehicle ?? null,
        plate_number: raw?.plate_number ?? raw?.plate ?? null,
      } as DriverRow;
    })
    .filter((d) => !!d.driver_id);

  const latestByDriver = new Map<string, DriverRow>();
  for (const d of out) {
    const key = String(d.driver_id || "");
    if (!key) continue;
    const prev = latestByDriver.get(key);
    const prevTs = prev?.updated_at ? new Date(prev.updated_at).getTime() : 0;
    const nextTs = d?.updated_at ? new Date(d.updated_at).getTime() : 0;
    if (!prev || nextTs >= prevTs) latestByDriver.set(key, d);
  }

  return Array.from(latestByDriver.values());
}
"@
  $client = [regex]::Replace($client, $anchor, $insert, 1)
}

# 3) Make loadDrivers prefer authoritative endpoints and normalize rows
$patternLoadDrivers = 'async function loadDrivers\(\) \{[\s\S]*?\n  \}'
$replacementLoadDrivers = @"
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

        const rawRows =
          safeArray<any>(j.drivers) ||
          safeArray<any>(j.data) ||
          safeArray<any>(j.rows) ||
          safeArray<any>(j["0"]) ||
          (Array.isArray(j) ? (j as any[]) : []);

        const arr = normalizeDriverRows(rawRows);
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
    setDriversDebug("No drivers loaded from authoritative admin driver-locations endpoints.");
  }
"@
$client = [regex]::Replace($client, $patternLoadDrivers, $replacementLoadDrivers, 1)

# 4) Pass drivers to map if not already passed
$client = [regex]::Replace(
  $client,
  '<LiveTripsMap\s+trips=\{visibleTrips as any\}\s+selectedTripId=\{selectedTripId\}\s+stuckTripIds=\{stuckTripIds as any\}\s*/>',
  '<LiveTripsMap trips={visibleTrips as any} drivers={drivers as any} selectedTripId={selectedTripId} stuckTripIds={stuckTripIds as any} />',
  1
)

# ----------------------------
# LiveTripsMap.tsx patches
# ----------------------------

# 1) Add drivers prop to interface
if ($map -notmatch 'drivers\s*:\s*any\[\]') {
  $map = [regex]::Replace(
    $map,
    'export interface LiveTripsMapProps \{\s*\n\s*trips: LiveTrip\[];',
    "export interface LiveTripsMapProps {`n  trips: LiveTrip[];`n  drivers?: any[];",
    1
  )
}

# 2) Add live driver marker ref
if ($map -notmatch 'liveDriverMarkersRef') {
  $map = [regex]::Replace(
    $map,
    'const driverMarkersRef = useRef<Record<string, mapboxgl.Marker>>\(\{\}\);',
    "const driverMarkersRef = useRef<Record<string, mapboxgl.Marker>>({});`n  const liveDriverMarkersRef = useRef<Record<string, mapboxgl.Marker>>({});",
    1
  )
}

# 3) Add helper functions after num if missing
if ($map -notmatch 'function\s+driverFeedCoord\s*\(') {
  $map = [regex]::Replace(
    $map,
    'function num\(v: any\): number \| null \{[\s\S]*?\n\}',
    @"
function num(v: any): number | null {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function driverFeedCoord(driver: any): LngLatTuple | null {
  const lat =
    num(driver?.lat) ??
    num(driver?.latitude) ??
    num(driver?.driver_lat) ??
    num(driver?.current_lat);
  const lng =
    num(driver?.lng) ??
    num(driver?.longitude) ??
    num(driver?.driver_lng) ??
    num(driver?.current_lng);
  if (lat != null && lng != null) return [lng, lat];
  return null;
}

function driverFeedKey(driver: any): string {
  return String(driver?.driver_id ?? driver?.id ?? driver?.uuid ?? "");
}

function driverFeedStatus(driver: any): string {
  return String(driver?.effective_status ?? driver?.status ?? "").trim().toLowerCase();
}

function driverFeedOnline(driver: any): boolean {
  const s = driverFeedStatus(driver);
  if (s === "stale") return false;
  if (typeof driver?.assign_online_eligible === "boolean") return !!driver.assign_online_eligible;
  return ["online", "available", "idle", "waiting", "assigned", "on_the_way", "on_trip"].includes(s);
}
"@,
    1
  )
}

# 4) Update component destructuring to include drivers
$map = [regex]::Replace(
  $map,
  'export const LiveTripsMap: React\.FC<LiveTripsMapProps> = \(\{\s*\n\s*trips,\s*\n\s*selectedTripId,\s*\n\s*stuckTripIds,\s*\n\s*\}\) => \{',
  "export const LiveTripsMap: React.FC<LiveTripsMapProps> = ({`n  trips,`n  drivers = [],`n  selectedTripId,`n  stuckTripIds,`n}) => {",
  1
)

# 5) Add authoritative live-driver marker effect before auto-follow if missing
if ($map -notmatch 'AUTHORITATIVE LIVE DRIVER FEED') {
  $insertEffect = @"

  // ===== AUTHORITATIVE LIVE DRIVER FEED =====
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!mapReady) return;

    const nextLive: Record<string, mapboxgl.Marker> = {};

    for (const raw of drivers || []) {
      const id = driverFeedKey(raw);
      if (!id) continue;

      const coord = driverFeedCoord(raw);
      if (!coord) continue;

      let marker = liveDriverMarkersRef.current[id];
      if (!marker) {
        const el = document.createElement("div");
        el.style.width = "14px";
        el.style.height = "14px";
        el.style.borderRadius = "9999px";
        el.style.border = "2px solid #ffffff";
        el.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.15)";
        marker = new mapboxgl.Marker(el).setLngLat(coord).addTo(map);
      } else {
        marker.setLngLat(coord);
      }

      const el = marker.getElement() as HTMLDivElement;
      el.style.backgroundColor = driverFeedOnline(raw) ? "#16a34a" : "#9ca3af";
      el.title = [
        raw?.name ?? "Driver",
        driverFeedStatus(raw) || "unknown",
        raw?.town ?? raw?.zone ?? "",
      ].filter(Boolean).join(" • ");

      nextLive[id] = marker;
    }

    for (const [id, marker] of Object.entries(liveDriverMarkersRef.current)) {
      if (!nextLive[id]) marker.remove();
    }

    liveDriverMarkersRef.current = nextLive;
  }, [drivers, mapReady]);
"@
  $map = [regex]::Replace(
    $map,
    '\n\s*// ===== AUTO-FOLLOW =====',
    "$insertEffect`n
  // ===== AUTO-FOLLOW =====",
    1
  )
}

# 6) Make selected trip follow prefer authoritative driver feed if trip has driver id
$map = [regex]::Replace(
  $map,
  'const driverReal = getDriverReal\(raw\);',
  @"
    const matchedDriver = (drivers || []).find(
      (d: any) => String(d?.driver_id ?? d?.id ?? "") === String(raw?.driver_id ?? raw?.driverId ?? "")
    );
    const driverReal = driverFeedCoord(matchedDriver) ?? getDriverReal(raw);
"@,
  1
)

Write-Utf8NoBom $clientPath $client
Write-Utf8NoBom $mapPath $map

Write-Host "[OK] Patched: $clientPath"
Write-Host "[OK] Patched: $mapPath"
Write-Host "DONE"
