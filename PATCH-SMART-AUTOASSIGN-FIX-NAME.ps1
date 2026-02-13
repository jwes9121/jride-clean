# PATCH-SMART-AUTOASSIGN-FIX-NAME.ps1
# Fixes helper shadowing SmartAutoAssignSuggestions component

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$t = Get-Content -LiteralPath $f -Raw -Encoding UTF8

# 1) Rename helper function to avoid collision
$t = $t.Replace(
  'function distMeters(aLat:number, aLng:number, bLat:number, bLng:number) {',
  'function calcDistanceMeters(aLat:number, aLng:number, bLat:number, bLng:number) {'
)

# 2) Update all usages
$t = $t.Replace(
  'distMeters(',
  'calcDistanceMeters('
)

# 3) Sanity check: component name must still exist
if ($t -notmatch 'function\s+SmartAutoAssignSuggestions\s*\(') {
  Fail "SmartAutoAssignSuggestions component definition not found after patch."
}

Set-Content -LiteralPath $f -Value $t -Encoding UTF8
Write-Host "FIXED: helper renamed to calcDistanceMeters (no JSX collision)" -ForegroundColor Green
