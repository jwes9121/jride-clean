param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function BackupFile([string]$absPath, [string]$tag, [string]$bakRoot) {
  if (!(Test-Path -LiteralPath $absPath)) { return $null }
  New-Item -ItemType Directory -Force -Path $bakRoot | Out-Null
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = Split-Path -Leaf $absPath
  $bak = Join-Path $bakRoot ($name + ".bak." + $tag + "." + $ts)
  Copy-Item -LiteralPath $absPath -Destination $bak -Force
  return $bak
}

Info "== JRIDE Patch: LiveTripsMap auto-fit to fleet drivers when 0 trips (V2 / PS5-safe) =="
Info "Repo: $ProjRoot"
Write-Host ""

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$bakRoot = Join-Path $ProjRoot "_patch_bak"
$mapPath = Join-Path $ProjRoot "app\admin\livetrips\components\LiveTripsMap.tsx"

if (!(Test-Path -LiteralPath $mapPath)) { Fail "[FAIL] LiveTripsMap.tsx not found: $mapPath" }

$bak = BackupFile $mapPath "LIVETRIPSMAP_AUTOFIT_FLEET_V2" $bakRoot
if ($bak) { Ok "[OK] Backup: $bak" }

$txt = [System.IO.File]::ReadAllText($mapPath, [System.Text.Encoding]::UTF8)

# Sanity: ensure file has the drivers effect section (our earlier patch)
if ($txt -notmatch "FLEET DRIVER MARKERS") {
  Fail "[FAIL] Could not find 'FLEET DRIVER MARKERS' in LiveTripsMap.tsx. This patch expects the fleet drivers marker version."
}

# 1) Ensure fleetFitDoneRef exists (insert after fleetMarkersRef with REGEX, not exact string)
if ($txt -match "fleetFitDoneRef") {
  Warn "[WARN] fleetFitDoneRef already present; skipping ref insert."
} else {
  $refInsertPattern = '(?ms)(const\s+fleetMarkersRef\s*=\s*useRef<[^;]*>\s*\(\s*\{\s*\}\s*\)\s*;)'
  if ($txt -notmatch $refInsertPattern) {
    Fail "[FAIL] Could not locate fleetMarkersRef declaration to insert fleetFitDoneRef."
  }

  $refBlock = @'
$1

  // One-time auto-fit to fleet drivers when there are no trips
  const fleetFitDoneRef = useRef<boolean>(false);
'@

  $txt = [System.Text.RegularExpressions.Regex]::Replace(
    $txt,
    $refInsertPattern,
    $refBlock,
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  Ok "[OK] Inserted fleetFitDoneRef (regex-based)."
}

# 2) Inject AUTO-FIT effect block before TRIP MARKERS + ROUTES (anchor is stable comment)
if ($txt -match "AUTO-FIT TO FLEET DRIVERS") {
  Warn "[WARN] AUTO-FIT block already present; skipping inject."
} else {
  $anchorPattern = '(?m)^\s*//\s*=====\s*TRIP MARKERS\s*\+\s*ROUTES\s*=====\s*$'
  if ($txt -notmatch $anchorPattern) {
    Fail "[FAIL] Could not find anchor comment: // ===== TRIP MARKERS + ROUTES ====="
  }

  $autoFitBlock = @'
  // ===== AUTO-FIT TO FLEET DRIVERS (when no trips) =====
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!mapReady) return;

    // Only auto-fit if there are no trips and we have at least 1 driver.
    if ((trips?.length ?? 0) > 0) return;
    if (!drivers || drivers.length === 0) return;

    // Do this once per page-load to avoid annoying jumps.
    if (fleetFitDoneRef.current) return;

    const coords: [number, number][] = [];
    for (const d of drivers) {
      const lat = num((d as any).lat);
      const lng = num((d as any).lng);
      if (lat == null || lng == null) continue;
      coords.push([lng, lat]);
    }

    if (coords.length === 0) return;

    try {
      if (coords.length === 1) {
        map.flyTo({ center: coords[0], zoom: 14, speed: 1.2, essential: true });
      } else {
        const bounds = coords.reduce(
          (b, c) => b.extend(c),
          new mapboxgl.LngLatBounds(coords[0], coords[0])
        );
        map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 900 });
      }
      fleetFitDoneRef.current = true;
    } catch {
      // ignore
    }
  }, [drivers, trips, mapReady]);

'@

  $txt = [System.Text.RegularExpressions.Regex]::Replace(
    $txt,
    $anchorPattern,
    $autoFitBlock + '$0',
    [System.Text.RegularExpressions.RegexOptions]::Multiline
  )

  Ok "[OK] Injected AUTO-FIT block (regex-based)."
}

# 3) Write back UTF-8 no BOM
WriteUtf8NoBom $mapPath $txt
Ok "[OK] Wrote LiveTripsMap.tsx (UTF-8 no BOM)."

Ok "[NEXT] Run: npm.cmd run build"