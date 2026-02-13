# PATCH-JRIDE_BACKEND_ACTIVE_TRIP_MATCH_BOTH_DRIVER_COLUMNS_V1.ps1
# Ensures active-trip matches driver on EITHER:
#   - driver_id == driverId
#   - assigned_driver_id == driverId
#
# Implements:
#   .or(`driver_id.eq.${driverId},assigned_driver_id.eq.${driverId}`)
# and keeps status filter (assigned/accepted/on_the_way/arrived/on_trip)
#
# Creates backup and patches first supabase query chain touching bookings OR active-trip selection.

$ErrorActionPreference = "Stop"

function Read-Utf8NoBom([string]$path) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  return [System.IO.File]::ReadAllText($path, $enc)
}
function Write-Utf8NoBom([string]$path, [string]$content) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $enc)
}

$root   = (Get-Location).Path
$target = Join-Path $root "app\api\driver\active-trip\route.ts"

if (!(Test-Path $target)) { throw "Missing file: $target" }

# Backup
$backupDir = Join-Path $root "_patch_backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp  = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $backupDir ("app__api__driver__active-trip__route.ts.bak.$stamp")
Copy-Item -Force $target $backup
Write-Host "[OK] Backup: $backup" -ForegroundColor Green

$txt = Read-Utf8NoBom $target

# Determine driver variable name
$driverVar = $null
if ($txt -match "(?m)^\s*const\s+driverId\s*=") { $driverVar = "driverId" }
elseif ($txt -match "(?m)^\s*let\s+driverId\s*=") { $driverVar = "driverId" }
elseif ($txt -match "(?m)^\s*const\s+driver_id\s*=") { $driverVar = "driver_id" }
elseif ($txt -match "(?m)^\s*const\s+did\s*=") { $driverVar = "did" }
else { $driverVar = "driverId" }

$statuses = '["assigned","accepted","on_the_way","arrived","on_trip"]'

# Find first supabase chain that queries bookings (or references .from('bookings'))
$pattern = "(?is)\.from\(\s*['""]bookings['""]\s*\)[\s\S]*?;"
$m = [regex]::Match($txt, $pattern)

if (-not $m.Success) {
  Write-Host "[NO CHANGE] Could not find any .from('bookings') query in $target" -ForegroundColor Red
  throw "No changes applied."
}

$chunk = $m.Value

# If already has an .or( driver_id.eq.,assigned_driver_id.eq. ) then exit
if ($chunk -match "\.or\(\s*`?['""]?driver_id\.eq\." -and $chunk -match "assigned_driver_id\.eq\.") {
  Write-Host "[OK] Already matches both driver_id and assigned_driver_id. No changes applied." -ForegroundColor Green
  exit 0
}

# Remove any existing .eq("driver_id", ...) if present inside the chunk (to avoid conflicting filters)
# We'll keep it if it references something else; but typical pattern is .eq("driver_id", driverId)
$chunk2 = $chunk
$chunk2 = [regex]::Replace($chunk2, "(?is)\s*\.eq\(\s*['""]driver_id['""]\s*,\s*"+[regex]::Escape($driverVar)+"\s*\)\s*", "`r`n      ", 1)

# Ensure status filter exists; if not, add it after select(...) when possible, else append.
$hasStatusIn = ($chunk2 -match "\.in\(\s*['""]status['""]\s*,")
$hasOr = ($chunk2 -match "\.or\(")

# Build OR filter: driver_id OR assigned_driver_id
$orFilter = ".or(`"driver_id.eq.$($driverVar),assigned_driver_id.eq.$($driverVar)`")"

# Insert logic:
# Prefer inserting right after first .select(...)
$selectPattern = "(?is)(\.select\([\s\S]*?\))"
$mSel = [regex]::Match($chunk2, $selectPattern)

if ($mSel.Success) {
  $afterSelPos = $mSel.Index + $mSel.Length
  $inject = ""
  if (-not $hasOr)       { $inject += "`r`n      $orFilter" }
  if (-not $hasStatusIn) { $inject += "`r`n      .in(`"status`", $statuses)" }

  $chunk2 = $chunk2.Substring(0, $afterSelPos) + $inject + $chunk2.Substring($afterSelPos)
} else {
  # Fallback: append at end before semicolon
  $inject = ""
  if (-not $hasOr)       { $inject += "`r`n      $orFilter" }
  if (-not $hasStatusIn) { $inject += "`r`n      .in(`"status`", $statuses)" }
  $chunk2 = $chunk2 -replace ";\s*$", ($inject + "`r`n;")
}

# Replace in file
$txt2 = $txt.Substring(0, $m.Index) + $chunk2 + $txt.Substring($m.Index + $m.Length)

Write-Utf8NoBom $target $txt2
Write-Host "[DONE] Patched active-trip to match both driver_id and assigned_driver_id" -ForegroundColor Green
Write-Host "       driver var: $driverVar" -ForegroundColor Green
Write-Host "       statuses  : $statuses" -ForegroundColor Green
