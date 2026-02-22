# PATCH-JRIDE_ADMIN_DRIVER_LOCATIONS_UNDERSCORE_ALIAS_V1_PS5SAFE.ps1
# Creates /api/admin/driver_locations as an alias to /api/admin/driver-locations
# so LiveTrips (which is calling underscore) will receive the same rows.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red; throw $m }

if (-not (Test-Path -LiteralPath $RepoRoot)) { Fail "RepoRoot not found: $RepoRoot" }

$dashRoute = Join-Path $RepoRoot "app\api\admin\driver-locations\route.ts"
$underDir  = Join-Path $RepoRoot "app\api\admin\driver_locations"
$underRoute = Join-Path $underDir "route.ts"

Info "== PATCH: underscore alias for admin driver locations (V1 / PS5-safe) =="
Info "RepoRoot: $RepoRoot"
Info "Dash route expected: $dashRoute"
Info "Underscore route to create: $underRoute"

if (-not (Test-Path -LiteralPath $dashRoute)) {
  Fail "Missing dash route file: $dashRoute`nOpen your repo and confirm the correct path for the working endpoint (/api/admin/driver-locations)."
}

if (-not (Test-Path -LiteralPath $underDir)) {
  New-Item -ItemType Directory -Path $underDir | Out-Null
  Ok "[OK] Created folder: $underDir"
} else {
  Info "[INFO] Folder exists: $underDir"
}

# If underscore route already exists, back it up first.
if (Test-Path -LiteralPath $underRoute) {
  $ts = (Get-Date).ToString("yyyyMMdd_HHmmss")
  $bak = Join-Path $RepoRoot ("_patch_bak\ADMIN_DRIVER_LOC_UNDERSCORE_ALIAS_V1")
  New-Item -ItemType Directory -Path $bak -Force | Out-Null
  $dest = Join-Path $bak ("route.ts.bak." + $ts)
  Copy-Item -LiteralPath $underRoute -Destination $dest -Force
  Warn "[WARN] Existing underscore route backed up to: $dest"
}

# Write alias route (ASCII-only; no BOM)
# Relative path from app/api/admin/driver_locations/route.ts to ../driver-locations/route.ts
$alias = @"
export { GET } from "../driver-locations/route";
"@

# Ensure ASCII/UTF8 no BOM
[System.IO.File]::WriteAllText($underRoute, $alias, (New-Object System.Text.UTF8Encoding($false)))

Ok "[OK] Wrote alias route: $underRoute"
Info ""
Info "NEXT:"
Info "1) Redeploy to Vercel (or run locally) so /api/admin/driver_locations uses the same handler as /api/admin/driver-locations."
Info "2) Refresh LiveTrips and confirm it no longer shows (0)."
Ok "[DONE]"