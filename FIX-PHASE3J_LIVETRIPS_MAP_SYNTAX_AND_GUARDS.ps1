# FIX-PHASE3J_LIVETRIPS_MAP_SYNTAX_AND_GUARDS.ps1
# Restores LiveTripsMap.tsx from the latest Phase3J backup and re-applies guardrails safely.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Ok($m){ Write-Host $m -ForegroundColor Green }

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$mapPath = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path $mapPath)) { Fail "Missing file: $mapPath" }

# Find the most recent .bak.* for this file
$bak = Get-ChildItem -LiteralPath (Split-Path $mapPath -Parent) -Filter "LiveTripsMap.tsx.bak.*" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (!$bak) { Fail "No backup found for LiveTripsMap.tsx (expected LiveTripsMap.tsx.bak.*)" }

Ok "[OK] Restoring from backup: $($bak.FullName)"
Copy-Item -Force $bak.FullName $mapPath

# Backup current restored file again (fresh safety)
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak2 = "$mapPath.bak.$ts"
Copy-Item -Force $mapPath $bak2
Ok "[OK] Safety backup: $bak2"

$txt = Get-Content -Raw -LiteralPath $mapPath

# --- 1) getPickup/getDropoff: ignore (0,0) ---
# Replace ONLY inside those function blocks
$pickupBlock = [regex]'function getPickup\(trip: any\): LngLatTuple \| null \{(?s).*?\n\}'
$m1 = $pickupBlock.Match($txt)
if ($m1.Success) {
  $b = $m1.Value
  $b2 = [regex]::Replace(
    $b,
    'if\s*\(\s*lat\s*!=\s*null\s*&&\s*lng\s*!=\s*null\s*\)\s*return\s*\[lng,\s*lat\]\s*;',
    'if (lat != null && lng != null && !(lat === 0 && lng === 0)) return [lng, lat];',
    1
  )
  if ($b2 -ne $b) {
    $txt = $txt.Remove($m1.Index, $m1.Length).Insert($m1.Index, $b2)
    Ok "[OK] Patched getPickup() to ignore (0,0)"
  } else {
    Info "[INFO] getPickup() already patched or pattern not found"
  }
} else {
  Info "[WARN] getPickup() block not found"
}

$dropBlock = [regex]'function getDropoff\(trip: any\): LngLatTuple \| null \{(?s).*?\n\}'
$m2 = $dropBlock.Match($txt)
if ($m2.Success) {
  $b = $m2.Value
  $b2 = [regex]::Replace(
    $b,
    'if\s*\(\s*lat\s*!=\s*null\s*&&\s*lng\s*!=\s*null\s*\)\s*return\s*\[lng,\s*lat\]\s*;',
    'if (lat != null && lng != null && !(lat === 0 && lng === 0)) return [lng, lat];',
    1
  )
  if ($b2 -ne $b) {
    $txt = $txt.Remove($m2.Index, $m2.Length).Insert($m2.Index, $b2)
    Ok "[OK] Patched getDropoff() to ignore (0,0)"
  } else {
    Info "[INFO] getDropoff() already patched or pattern not found"
  }
} else {
  Info "[WARN] getDropoff() block not found"
}

# --- 2) Insert helper in SAFE place: right before function num( ---
if ($txt -notmatch "function\s+isActiveStatusForProblem\(") {
  $anchor = "function num("
  if ($txt -notmatch [regex]::Escape($anchor)) { Fail "Anchor not found: function num(" }

  $helper = @'
function isActiveStatusForProblem(s: any): boolean {
  const x = String(s ?? "").trim().toLowerCase();
  return ["pending","assigned","on_the_way","arrived","enroute","on_trip"].includes(x);
}

'@
  $txt = $txt -replace [regex]::Escape($anchor), ($helper + $anchor)
  Ok "[OK] Inserted isActiveStatusForProblem() before function num()"
} else {
  Info "[SKIP] isActiveStatusForProblem() already present"
}

# --- 3) Guard problem flags to active statuses only ---
# Audio/KPI loops use tRaw.isProblem; marker uses raw.isProblem
# Replace up to 2 occurrences for tRaw (audio + KPI), and 1 for raw.

# Replace first 2 occurrences
$txt = [regex]::Replace(
  $txt,
  'const\s+isProblem\s*=\s*!!\s*tRaw\.isProblem\s*;',
  'const isProblem = !!tRaw.isProblem && isActiveStatusForProblem(tRaw.status);',
  2
)

# Replace marker occurrence
$txt = [regex]::Replace(
  $txt,
  'const\s+isProblem\s*=\s*!!\s*raw\.isProblem\s*;',
  'const isProblem = !!raw.isProblem && isActiveStatusForProblem(raw.status);',
  1
)

Ok "[OK] Applied problem-status guards (active-only)"

# --- Write UTF-8 no BOM ---
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($mapPath, $txt, $utf8NoBom)
Ok "[OK] Wrote: $mapPath"

Ok "DONE: LiveTripsMap.tsx syntax restored + Phase 3J guards re-applied safely."
