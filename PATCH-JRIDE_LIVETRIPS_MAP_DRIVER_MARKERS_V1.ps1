# PATCH-JRIDE_LIVETRIPS_MAP_DRIVER_MARKERS_V1.ps1
# V1.2 - Tolerant matcher for <LiveTripsMap ... /> call (no exact-line anchor)
# Adds fleet driver markers to LiveTripsMap and passes drivers from LiveTripsClient
# Safe: backups + idempotent inserts

$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }

$root = Get-Location

$clientPath = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
$mapPath    = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"

if (!(Test-Path $clientPath)) { Fail "Missing: $clientPath" }
if (!(Test-Path $mapPath))    { Fail "Missing: $mapPath" }

$ts = Stamp
Copy-Item $clientPath "$clientPath.bak.$ts" -Force
Copy-Item $mapPath    "$mapPath.bak.$ts" -Force
Write-Host "[OK] Backup: $clientPath.bak.$ts"
Write-Host "[OK] Backup: $mapPath.bak.$ts"

# -------------------------
# 1) LiveTripsClient: inject drivers prop into <LiveTripsMap ... />
# -------------------------
$client = Get-Content -Raw -LiteralPath $clientPath

if ($client -notmatch "<LiveTripsMap\b") {
  Fail "Could not find <LiveTripsMap in LiveTripsClient.tsx"
}

# If already has drivers= prop on LiveTripsMap, skip.
if ($client -match "<LiveTripsMap\b[^>]*\bdrivers\s*=") {
  Write-Host "[OK] LiveTripsClient.tsx already passes drivers prop (skip)"
} else {
  # Match the first self-closing LiveTripsMap tag (including multiline)
  $rx = New-Object System.Text.RegularExpressions.Regex(
    "<LiveTripsMap\b(?<attrs>[\s\S]*?)\/>",
    [System.Text.RegularExpressions.RegexOptions]::Multiline
  )

  $m = $rx.Match($client)
  if (!$m.Success) {
    Fail "Could not locate a self-closing <LiveTripsMap ... /> tag to patch."
  }

  $full = $m.Value
  $attrs = $m.Groups["attrs"].Value

  # Insert drivers prop right after component name for minimal disturbance.
  # Keep original formatting by injecting with a leading space.
  $patched = $full -replace "<LiveTripsMap\b", "<LiveTripsMap drivers={drivers as any}"

  # Safety: ensure we didn't accidentally duplicate drivers
  if ($patched -match "<LiveTripsMap\b[^>]*\bdrivers\s*=" -and $full -notmatch "\bdrivers\s*=") {
    $client = $client.Substring(0, $m.Index) + $patched + $client.Substring($m.Index + $m.Length)
    Set-Content -LiteralPath $clientPath -Value $client -Encoding UTF8
    Write-Host "[OK] Patched LiveTripsClient.tsx (injected drivers prop into LiveTripsMap)"
  } else {
    Fail "Unexpected: drivers injection did not apply cleanly."
  }
}

# -------------------------
# 2) LiveTripsMap: add drivers prop + render fleet markers
# -------------------------
$map = Get-Content -Raw -LiteralPath $mapPath

# A) Ensure props interface includes drivers
if ($map -match "export interface LiveTripsMapProps\s*\{[\s\S]*?\bdrivers\s*:") {
  Write-Host "[OK] LiveTripsMapProps already has drivers (skip)"
} else {
  $rxProps = New-Object System.Text.RegularExpressions.Regex(
    "export interface LiveTripsMapProps\s*\{(?<body>[\s\S]*?)\}",
    [System.Text.RegularExpressions.RegexOptions]::Multiline
  )
  $pm = $rxProps.Match($map)
  if (!$pm.Success) { Fail "Could not find LiveTripsMapProps interface in LiveTripsMap.tsx" }

  $body = $pm.Groups["body"].Value

  # Insert drivers after trips line if possible
  if ($body -match "trips:\s*LiveTrip\[\];") {
    $newBody = $body -replace "trips:\s*LiveTrip\[\];", "trips: LiveTrip[];`r`n  drivers: any[]; // fleet driver locations from /api/admin/driver_locations"
  } else {
    # Fallback: add at top
    $newBody = "`r`n  drivers: any[]; // fleet driver locations from /api/admin/driver_locations`r`n" + $body
  }

  $map = $map.Substring(0, $pm.Index) + "export interface LiveTripsMapProps {" + $newBody + "}" + $map.Substring($pm.Index + $pm.Length)
  Set-Content -LiteralPath $mapPath -Value $map -Encoding UTF8
  $map = Get-Content -Raw -LiteralPath $mapPath
  Write-Host "[OK] Patched LiveTripsMapProps (added drivers)"
}

# B) Ensure component destructures drivers
if ($map -match "LiveTripsMapProps>\s*=\s*\(\s*\{\s*[\s\S]*\bdrivers\b") {
  Write-Host "[OK] LiveTripsMap already destructures drivers (skip)"
} else {
  # Replace "({ trips, ... })" with "({ trips, drivers, ... })" in a tolerant way.
  $rxDes = New-Object System.Text.RegularExpressions.Regex(
    "export const LiveTripsMap:\s*React\.FC<LiveTripsMapProps>\s*=\s*\(\s*\{\s*(?<inner>[\s\S]*?)\s*\}\s*\)\s*=>\s*\{",
    [System.Text.RegularExpressions.RegexOptions]::Multiline
  )
  $dm = $rxDes.Match($map)
  if (!$dm.Success) { Fail "Could not find LiveTripsMap component signature to inject drivers." }

  $inner = $dm.Groups["inner"].Value
  # Put drivers right after trips if trips exists, else prepend
  if ($inner -match "\btrips\b") {
    $inner2 = $inner -replace "\btrips\b\s*,", "trips,`r`n  drivers,"
    if ($inner2 -eq $inner) {
      # trips might be last without comma
      $inner2 = $inner -replace "\btrips\b", "trips,`r`n  drivers"
    }
  } else {
    $inner2 = "drivers,`r`n  " + $inner
  }

  $newSig = $dm.Value -replace [regex]::Escape($inner), [System.Text.RegularExpressions.Regex]::Escape($inner2)
  # Above escaping is tricky; do a direct rebuild instead:
  $newSig = "export const LiveTripsMap: React.FC<LiveTripsMapProps> = ({`r`n  " + ($inner2.Trim()) + "`r`n}) => {"

  $map = $map.Substring(0, $dm.Index) + $newSig + $map.Substring($dm.Index + $dm.Length)
  Set-Content -LiteralPath $mapPath -Value $map -Encoding UTF8
  $map = Get-Content -Raw -LiteralPath $mapPath
  Write-Host "[OK] Patched LiveTripsMap signature (added drivers destructure)"
}

# C) Ensure fleet markers ref exists
if ($map -match "fleetDriverMarkersRef") {
  Write-Host "[OK] Fleet markers ref already present (skip)"
} else {
  $needle = "const driverMarkersRef = useRef<Record<string, mapboxgl.Marker>>({});"
  if ($map -notmatch [regex]::Escape($needle)) {
    Fail "Could not find driverMarkersRef line to insert fleet ref."
  }

  $map = $map.Replace(
    $needle,
@'
  // Trip markers (per booking)
  const driverMarkersRef = useRef<Record<string, mapboxgl.Marker>>({});

  // Fleet driver markers (from /api/admin/driver_locations)
  const fleetDriverMarkersRef = useRef<Record<string, mapboxgl.Marker>>({});
'@
  )

  Set-Content -LiteralPath $mapPath -Value $map -Encoding UTF8
  $map = Get-Content -Raw -LiteralPath $mapPath
  Write-Host "[OK] Inserted fleetDriverMarkersRef"
}

# D) Insert helpers once (before Coordinate helpers header)
$coordHeader = "// ---------- Coordinate helpers ----------"
if ($map -notmatch [regex]::Escape($coordHeader)) {
  Fail "Could not find coordinate helpers header in LiveTripsMap.tsx"
}

if ($map -match "function fleetMarkerColor") {
  Write-Host "[OK] Fleet helper functions already present (skip)"
} else {
  $insertFleetHelpers = @'
type FleetDriverRow = {
  driver_id?: string | null;
  name?: string | null;
  town?: string | null;
  status?: string | null;
  lat?: number | null;
  lng?: number | null;
  updated_at?: string | null;
};

function norm(s: any): string {
  return String(s ?? "").trim().toLowerCase();
}

function getFleetLngLat(d: any): LngLatTuple | null {
  const lat = num(d?.lat);
  const lng = num(d?.lng);
  if (lat != null && lng != null) return [lng, lat];
  return null;
}

function fleetMarkerColor(statusRaw: any): { bg: string; ring: string; show: boolean } {
  const s = norm(statusRaw);

  // Hidden: offline / disabled
  if (!s || s === "offline" || s.includes("offline")) {
    return { bg: "#94a3b8", ring: "#ffffff", show: false };
  }

  // Available => GREEN
  if (s === "available" || s === "online" || s === "idle" || s.includes("waiting")) {
    return { bg: "#22c55e", ring: "#ffffff", show: true };
  }

  // Busy / moving / on-trip => non-green
  if (s === "on_trip" || s === "on_the_way" || s.includes("busy")) {
    return { bg: "#f59e0b", ring: "#ffffff", show: true };
  }

  // Default visible but neutral
  return { bg: "#3b82f6", ring: "#ffffff", show: true };
}

'@

  $map = $map.Replace($coordHeader, $insertFleetHelpers + $coordHeader)
  Set-Content -LiteralPath $mapPath -Value $map -Encoding UTF8
  $map = Get-Content -Raw -LiteralPath $mapPath
  Write-Host "[OK] Inserted fleet helper functions"
}

# E) Insert fleet marker effect once (before MARKERS + ROUTES header)
$markerHeader = "// ===== MARKERS + ROUTES ====="
if ($map -notmatch [regex]::Escape($markerHeader)) {
  Fail "Could not find MARKERS + ROUTES header in LiveTripsMap.tsx"
}

if ($map -match "FLEET DRIVER MARKERS") {
  Write-Host "[OK] Fleet marker effect already present (skip)"
} else {
  $fleetEffect = @'
// ===== FLEET DRIVER MARKERS (from drivers prop) =====
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!mapReady) return;

    const next: Record<string, mapboxgl.Marker> = {};

    const list = Array.isArray(drivers) ? (drivers as any[]) : [];
    for (const d of list) {
      const id = String(d?.driver_id ?? "");
      if (!id) continue;

      const pos = getFleetLngLat(d);
      if (!pos) continue;

      const color = fleetMarkerColor(d?.status);
      if (!color.show) {
        const prev = fleetDriverMarkersRef.current[id];
        if (prev) prev.remove();
        continue;
      }

      let marker = fleetDriverMarkersRef.current[id];
      if (!marker) {
        const el = document.createElement("div");
        el.style.width = "14px";
        el.style.height = "14px";
        el.style.borderRadius = "9999px";
        el.style.backgroundColor = color.bg;
        el.style.border = `2px solid ${color.ring}`;
        el.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.08)";
        el.style.transform = "translate(-50%, -50%)";
        el.title = `${d?.name ?? "Driver"}${d?.town ? " — " + d.town : ""}${d?.status ? " — " + d.status : ""}`;
        marker = new mapboxgl.Marker(el).setLngLat(pos).addTo(map);
      } else {
        marker.setLngLat(pos);
        const el = marker.getElement() as HTMLElement;
        el.style.backgroundColor = color.bg;
        el.title = `${d?.name ?? "Driver"}${d?.town ? " — " + d.town : ""}${d?.status ? " — " + d.status : ""}`;
      }

      next[id] = marker;
    }

    for (const [id, marker] of Object.entries(fleetDriverMarkersRef.current)) {
      if (!next[id]) marker.remove();
    }

    fleetDriverMarkersRef.current = next;
  }, [drivers, mapReady]);
'@

  $map = $map.Replace($markerHeader, $fleetEffect + "`r`n" + $markerHeader)
  Set-Content -LiteralPath $mapPath -Value $map -Encoding UTF8
  Write-Host "[OK] Inserted fleet marker effect"
}

Write-Host ""
Write-Host "[DONE] Patch completed."
Write-Host "[NEXT] npm.cmd run build"
