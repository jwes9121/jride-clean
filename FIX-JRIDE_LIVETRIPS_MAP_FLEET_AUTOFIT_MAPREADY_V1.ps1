# FIX-JRIDE_LIVETRIPS_MAP_FLEET_AUTOFIT_MAPREADY_V1.ps1
# Replaces mapReady gate in Fleet Auto-Fit block with map.loaded() check.

$ErrorActionPreference = "Stop"
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }

$root = Get-Location
$path = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path $path)) { Fail "Missing: $path" }

$ts = Stamp
Copy-Item $path "$path.bak.$ts" -Force
Write-Host "[OK] Backup: $path.bak.$ts"

$txt = Get-Content -Raw -LiteralPath $path

# Ensure the block exists
if ($txt -notmatch "FLEET AUTO-FIT") { Fail "Could not find 'FLEET AUTO-FIT' block in LiveTripsMap.tsx" }

# Replace the specific line `if (!mapReady) return;` inside that block
if ($txt -notmatch "if\s*\(\s*!\s*mapReady\s*\)\s*return;") {
  Write-Host "[OK] No mapReady gate found (skip)."
} else {
  $txt = $txt -replace "if\s*\(\s*!\s*mapReady\s*\)\s*return;", "if (!(map as any).loaded || !(map as any).loaded()) return;"
  Write-Host "[DONE] Replaced mapReady gate with map.loaded() check"
}

# Also remove mapReady from dependency array of that effect if present
$txt = $txt -replace "\[\s*drivers\s*,\s*selectedTripId\s*,\s*mapReady\s*\]", "[drivers, selectedTripId]"
$txt = $txt -replace "\[\s*drivers\s*,\s*mapReady\s*,\s*selectedTripId\s*\]", "[drivers, selectedTripId]"

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Write-Host "[NEXT] npm.cmd run build"
