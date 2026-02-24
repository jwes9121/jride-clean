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

Info "== JRIDE Patch: LiveTripsMap refit fleet on change when 0 trips (V5 / PS5-safe) =="
Info "Repo: $ProjRoot"
Write-Host ""

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$mapPath = Join-Path $ProjRoot "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path -LiteralPath $mapPath)) { Fail "[FAIL] LiveTripsMap.tsx not found: $mapPath" }

$bakRoot = Join-Path $ProjRoot "_patch_bak"
$bak = BackupFile $mapPath "LIVETRIPSMAP_FLEET_REFIT_V5" $bakRoot
if ($bak) { Ok "[OK] Backup: $bak" }

$txt = [System.IO.File]::ReadAllText($mapPath, [System.Text.Encoding]::UTF8)

# 1) Replace fleetFitDoneRef with fleetFitKeyRef (idempotent-ish)
if ($txt -match 'fleetFitDoneRef') {
  $txt = [System.Text.RegularExpressions.Regex]::Replace(
    $txt,
    '(?m)^\s*const\s+fleetFitDoneRef\s*=\s*useRef<boolean>\(false\);\s*$',
    '  const fleetFitKeyRef = useRef<string>("");'
  )
  $txt = $txt -replace 'fleetFitDoneRef', 'fleetFitKeyRef'
  Ok "[OK] Switched fleetFitDoneRef -> fleetFitKeyRef."
} elseif ($txt -match 'fleetFitKeyRef') {
  Warn "[WARN] fleetFitKeyRef already present."
} else {
  Warn "[WARN] No fleetFitDoneRef/fleetFitKeyRef found; continuing."
}

# 2) Patch the fit logic inside the fleet markers hook (V4/V5)
# Convert "if (!fleetFitKeyRef.current && trips==0 ...)" to "if (trips==0 && key != lastKey)"
$fitBlockPat = '(?ms)try\s*\{\s*if\s*\(\s*!fleetFitKeyRef\.current\s*&&\s*\(trips\?\.\s*length\s*\?\?\s*0\)\s*===\s*0\s*&&\s*ids\.size\s*>\s*0\s*\)\s*\{[\s\S]*?fleetFitKeyRef\.current\s*=\s*true\s*;[\s\S]*?\}\s*\}\s*catch\s*\{\s*\}'
if ($txt -match $fitBlockPat) {
  $replacement = @'
try {
      if ((trips?.length ?? 0) === 0 && ids.size > 0) {
        // Refit whenever the fleet set changes (IDs), so new online drivers appear automatically.
        const key = Array.from(ids).sort().join("|");
        if (fleetFitKeyRef.current !== key) {
          const bounds = new mapboxgl.LngLatBounds();
          for (const d of list) {
            const lat = toNum(d?.lat ?? d?.latitude);
            const lng = toNum(d?.lng ?? d?.lon ?? d?.longitude);
            if (lat == null || lng == null) continue;
            bounds.extend([lng, lat]);
          }
          if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 600 });
            fleetFitKeyRef.current = key;
          }
        }
      }
    } catch { }
'@
  $txt = [System.Text.RegularExpressions.Regex]::Replace($txt, $fitBlockPat, $replacement)
  Ok "[OK] Patched fleet fitBounds to refit on fleet change."
} else {
  Warn "[WARN] Could not locate the exact old fitBounds block to replace. Trying a looser patch…"

  # Looser patch: insert a refit block just before the end of the fleet hook if we can find the V4 marker
  $v4Pat = '(?ms)//\s*===== FLEET DRIVER MARKERS \(V4\) =====[\s\S]*?//\s*JRIDE_FLEET_MARKERS_V4'
  if ($txt -notmatch $v4Pat) {
    Fail "[FAIL] Could not find the fleet markers hook (JRIDE_FLEET_MARKERS_V4) to patch."
  }

  # If a fitBounds already exists, do not double-inject
  if ($txt -match 'Re\-fit whenever the fleet set changes') {
    Warn "[WARN] Refit-on-change block already present."
  } else {
    $injectBefore = '(?ms)(\}\s*,\s*\[drivers,\s*trips\]\s*\)\s*;\s*//\s*JRIDE_FLEET_MARKERS_V4)'
    if ($txt -notmatch $injectBefore) { Fail "[FAIL] Could not anchor injection before JRIDE_FLEET_MARKERS_V4 end." }

    $extra = @'
    // Refit whenever the fleet set changes (IDs), so new online drivers appear automatically.
    try {
      if ((trips?.length ?? 0) === 0 && ids.size > 0) {
        const key = Array.from(ids).sort().join("|");
        if (fleetFitKeyRef.current !== key) {
          const bounds = new mapboxgl.LngLatBounds();
          for (const d of list) {
            const lat = toNum(d?.lat ?? d?.latitude);
            const lng = toNum(d?.lng ?? d?.lon ?? d?.longitude);
            if (lat == null || lng == null) continue;
            bounds.extend([lng, lat]);
          }
          if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 600 });
            fleetFitKeyRef.current = key;
          }
        }
      }
    } catch { }

'@
    $txt = [System.Text.RegularExpressions.Regex]::Replace($txt, $injectBefore, $extra + '$1')
    Ok "[OK] Injected refit-on-change block (loose mode)."
  }
}

WriteUtf8NoBom $mapPath $txt
Ok "[OK] Wrote LiveTripsMap.tsx (UTF-8 no BOM)."
Ok "[NEXT] Run: npm.cmd run build"