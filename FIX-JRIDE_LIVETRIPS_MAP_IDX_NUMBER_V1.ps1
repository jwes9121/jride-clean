# FIX-JRIDE_LIVETRIPS_MAP_IDX_NUMBER_V1.ps1
# Fixes TS error: Parameter 'idx' implicitly has an 'any' type by typing idx: number.

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

# Tolerant replacement: only touch the specific pattern "map((t: any, idx) =>"
if ($txt -notmatch "map\(\(t:\s*any,\s*idx\)\s*=>") {
  Fail "Anchor not found: map((t: any, idx) =>"
}

$txt2 = $txt -replace "map\(\(t:\s*any,\s*idx\)\s*=>", "map((t: any, idx: number) =>"

Set-Content -LiteralPath $path -Value $txt2 -Encoding UTF8
Write-Host "[DONE] Patched idx to idx: number"
Write-Host "[NEXT] npm.cmd run build"
