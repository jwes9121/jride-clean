param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

Write-Host "== PATCH JRIDE: Stop LiveTripsMap auto-fit after user interaction (V1.1 / PS5-safe) =="

$target = Join-Path $ProjRoot "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path -LiteralPath $target)) {
  $alt = Join-Path $ProjRoot "app\admin\livetrips\LiveTripsMap.tsx"
  if (Test-Path -LiteralPath $alt) { $target = $alt }
  else { throw "LiveTripsMap.tsx not found at expected paths." }
}

$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir ("LiveTripsMap.tsx.bak.STOP_AUTOFIT_AFTER_INTERACT_V1_1." + $ts)
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$content = Get-Content -LiteralPath $target -Raw -Encoding UTF8
$changed = $false

# 1) Add ref (only once)
if ($content -notmatch "const\s+userInteractedRef\s*=\s*useRef") {
  $reUseEffect = [regex]::new("(?m)^\s*useEffect\(\(", [System.Text.RegularExpressions.RegexOptions]::Multiline)
  $m = $reUseEffect.Match($content)
  if (-not $m.Success) { throw "Anchor not found: first useEffect. File shape unexpected." }

  $insert = @'
  // Once user drags/zooms the map, stop auto-fit recentering
  const userInteractedRef = useRef(false);

'@
  $content = $content.Insert($m.Index, $insert)
  $changed = $true
  Write-Host "[OK] Inserted userInteractedRef before first useEffect()."
} else {
  Write-Host "[OK] userInteractedRef already present."
}

# 2) Add map listeners (only once)
if ($content -notmatch "userInteractedRef\.current\s*=\s*true") {
  # try a couple anchors where map is available
  $anchors = @(
    "mapRef.current = map;",
    "mapRef.current=map;"
  )
  $idx = -1
  $anchorUsed = $null
  foreach ($a in $anchors) {
    $idx = $content.IndexOf($a)
    if ($idx -ge 0) { $anchorUsed = $a; break }
  }

  if ($idx -lt 0) {
    Write-Host "[WARN] Could not find mapRef.current assignment anchor. Skipping interaction listeners insertion."
  } else {
    $after = $idx + $anchorUsed.Length
    $ins = @'
    // Stop auto-fit once user interacts
    map.on("dragstart", () => { userInteractedRef.current = true; });
    map.on("zoomstart", () => { userInteractedRef.current = true; });
    map.on("rotatestart", () => { userInteractedRef.current = true; });
    map.on("pitchstart", () => { userInteractedRef.current = true; });

'@
    $content = $content.Insert($after, $ins)
    $changed = $true
    Write-Host "[OK] Inserted map interaction listeners."
  }
} else {
  Write-Host "[OK] Interaction listeners already present."
}

# 3) Guard auto-recenter calls using plain string replacements (PS5-safe, no regex hell)
if ($content -notlike "*if (!userInteractedRef.current)*") {
  $repls = @(
    @{ from = "map.fitBounds("; to = "if (!userInteractedRef.current) map.fitBounds(" },
    @{ from = "map.flyTo(";    to = "if (!userInteractedRef.current) map.flyTo(" },
    @{ from = "map.easeTo(";   to = "if (!userInteractedRef.current) map.easeTo(" },
    @{ from = "map.jumpTo(";   to = "if (!userInteractedRef.current) map.jumpTo(" },

    @{ from = "mapRef.current?.fitBounds("; to = "if (!userInteractedRef.current) mapRef.current?.fitBounds(" },
    @{ from = "mapRef.current?.flyTo(";    to = "if (!userInteractedRef.current) mapRef.current?.flyTo(" },
    @{ from = "mapRef.current?.easeTo(";   to = "if (!userInteractedRef.current) mapRef.current?.easeTo(" },
    @{ from = "mapRef.current?.jumpTo(";   to = "if (!userInteractedRef.current) mapRef.current?.jumpTo(" }
  )

  $didGuard = $false
  foreach ($r in $repls) {
    if ($content -like "*$($r.from)*") {
      $content = $content.Replace($r.from, $r.to)
      $didGuard = $true
    }
  }

  if ($didGuard) {
    $changed = $true
    Write-Host "[OK] Guarded fitBounds/flyTo/easeTo/jumpTo with userInteractedRef."
  } else {
    Write-Host "[WARN] No fitBounds/flyTo/easeTo/jumpTo calls found to guard."
  }
} else {
  Write-Host "[OK] Guard already present; skipping auto-fit guarding."
}

if (-not $changed) {
  Write-Host "[WARN] No changes applied (already patched or anchors not found)."
} else {
  # Write UTF-8 WITHOUT BOM
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($target, $content, $utf8NoBom)
  Write-Host "[OK] Wrote: $target"
}

Write-Host ""
Write-Host "NEXT: npm run build, then test /admin/livetrips zoom behavior."