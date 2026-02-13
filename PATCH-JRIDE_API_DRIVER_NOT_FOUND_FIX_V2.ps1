# PATCH-JRIDE_API_DRIVER_NOT_FOUND_FIX_V2.ps1
# Goal: Fix { ok:false, error:"driver not found" } triggered by GO ONLINE/GO OFFLINE
# This script scans ALL Next.js route handlers under app\api\**\route.ts and applies safe, targeted fixes:
#   1) driver_profiles has NO "id" column in your schema; correct is "driver_id"
#      .from("driver_profiles") ... .eq("id", <driverIdVar>)  ==> .eq("driver_id", <driverIdVar>)
#   2) (optional) if a route checks drivers using the wrong column "driver_id" (when it should be "id"), we only patch it
#      when the file clearly indicates "driver not found" behavior.
#
# It ALWAYS:
#  - creates a timestamped .bak backup
#  - prints patched files
#  - never touches unrelated routes

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[ERR]  $msg" -ForegroundColor Red }

function Backup-File($path) {
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak.$ts"
  Copy-Item -LiteralPath $path -Destination $bak -Force
  return $bak
}

function Patch-RouteFile($path) {
  $orig = Get-Content -LiteralPath $path -Raw

  # Heuristics: only patch if file likely participates in "driver not found" logic
  $hasDriverNotFound =
    ($orig -match '(?i)driver not found') -or
    ($orig -match 'DRIVER_NOT_FOUND') -or
    ($orig -match 'driver_not_found') -or
    ($orig -match '(?i)MISSING_DRIVER') -or
    ($orig -match '(?i)NO_DRIVER')

  $mentionsDriverTables =
    ($orig -match 'driver_profiles') -or
    ($orig -match 'drivers') -or
    ($orig -match 'driver_locations') -or
    ($orig -match 'driver_device_locks')

  if (-not ($hasDriverNotFound -or ($mentionsDriverTables -and ($orig -match '(?i)driver')))) {
    return @{ changed = $false; reason = "Not a driver-related route / no driver-not-found signature" }
  }

  $txt = $orig
  $changed = $false

  # --- Patch 1: driver_profiles wrong column ---
  # Fix ONLY when the query is clearly on driver_profiles
  # .from("driver_profiles") ... .eq("id", X)  ==> .eq("driver_id", X)
  $before = $txt
  $txt = [regex]::Replace(
    $txt,
    '(?s)(\.from\(\s*["'']driver_profiles["'']\s*\).*?\.eq\(\s*["'']id["'']\s*,\s*([a-zA-Z0-9_\.]+)\s*\))',
    { param($m)
      $m.Value -replace '["'']id["'']', '"driver_id"'
    }
  )
  if ($txt -ne $before) { $changed = $true }

  # --- Patch 2 (guarded): drivers wrong column ---
  # Some routes mistakenly do: .from("drivers") ... .eq("driver_id", driverId)
  # In your schema, drivers primary key is "id".
  # We ONLY patch this when the file also has a driver-not-found signature, to avoid touching unrelated joins.
  if ($hasDriverNotFound) {
    $before2 = $txt
    $txt = [regex]::Replace(
      $txt,
      '(?s)(\.from\(\s*["'']drivers["'']\s*\).*?\.eq\(\s*["'']driver_id["'']\s*,\s*([a-zA-Z0-9_\.]+)\s*\))',
      { param($m)
        $m.Value -replace '["'']driver_id["'']', '"id"'
      }
    )
    if ($txt -ne $before2) { $changed = $true }
  }

  if (-not $changed) {
    return @{ changed = $false; reason = "No target patterns found (driver_profiles.id or drivers.driver_id)" }
  }

  $bak = Backup-File $path
  Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
  return @{ changed = $true; backup = $bak }
}

# --- Main ---
$repoRoot = (Get-Location).Path
Write-Info "Repo root: $repoRoot"

$apiRoot = Join-Path $repoRoot "app\api"
if (-not (Test-Path -LiteralPath $apiRoot)) {
  throw "Could not find app\api at: $apiRoot"
}

Write-Info "Scanning for route.ts under: $apiRoot"
$routes = Get-ChildItem -LiteralPath $apiRoot -Recurse -File -Filter "route.ts" | Select-Object -ExpandProperty FullName
if (-not $routes -or $routes.Count -eq 0) {
  throw "No route.ts files found under app\api"
}

$patched = @()
$notes = @()

foreach ($p in $routes) {
  try {
    $res = Patch-RouteFile $p
    if ($res.changed) {
      Write-Ok "Patched: $p"
      Write-Ok "Backup:  $($res.backup)"
      $patched += $p
    } else {
      $notes += @{ path = $p; reason = $res.reason }
    }
  } catch {
    $notes += @{ path = $p; reason = "ERROR: $($_.Exception.Message)" }
  }
}

Write-Info "---- Summary ----"
Write-Info ("Scanned route.ts count: {0}" -f $routes.Count)
Write-Info ("Patched count: {0}" -f $patched.Count)

if ($patched.Count -gt 0) {
  Write-Info "Patched files:"
  foreach ($p in $patched) { Write-Host "  - $p" }
} else {
  Write-Warn "No files were patched."
  Write-Warn "That means your failing endpoint does not contain driver_profiles.id or drivers.driver_id patterns."
  Write-Warn "Next step: search output for the exact route hit by the phone (we can do that with logs), or upload the route file for GO ONLINE/GO OFFLINE."
}

# Print small note sample
$show = [Math]::Min(12, $notes.Count)
if ($show -gt 0) {
  Write-Info "Notes (first $show):"
  for ($i=0; $i -lt $show; $i++) {
    Write-Host ("  - {0}`n    {1}" -f $notes[$i].path, $notes[$i].reason)
  }
}
