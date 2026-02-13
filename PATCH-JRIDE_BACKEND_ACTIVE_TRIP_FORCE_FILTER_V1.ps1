# PATCH-JRIDE_BACKEND_ACTIVE_TRIP_FORCE_FILTER_V1.ps1
# Force-inject active-trip filters:
# - .eq("driver_id", <driverIdVar>)
# - .in("status", ["assigned","accepted","on_the_way","arrived","on_trip"])
# Injected right after the first .select(...) chained off .from("bookings")
# Creates backup and fails loudly if it can't find the bookings select chain.

$ErrorActionPreference = "Stop"

function Read-Utf8NoBom([string]$path) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  return [System.IO.File]::ReadAllText($path, $enc)
}
function Write-Utf8NoBom([string]$path, [string]$content) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $enc)
}

$root = (Get-Location).Path
$target = Join-Path $root "app\api\driver\active-trip\route.ts"

if (!(Test-Path $target)) {
  throw "Missing file: $target`nMake sure you are in repo root (jride-clean-fresh)."
}

$backupDir = Join-Path $root "_patch_backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $backupDir ("app__api__driver__active-trip__route.ts.bak.$stamp")
Copy-Item -Force $target $backup
Write-Host "[OK] Backup: $backup" -ForegroundColor Green

$txt = Read-Utf8NoBom $target

# Detect driverId variable name commonly used in route.ts
# We will prefer: driverId -> driver_id -> did
$driverVar = $null
if ($txt -match "(?m)^\s*const\s+driverId\s*=") { $driverVar = "driverId" }
elseif ($txt -match "(?m)^\s*const\s+driver_id\s*=") { $driverVar = "driver_id" }
elseif ($txt -match "(?m)^\s*const\s+did\s*=") { $driverVar = "did" }
else { $driverVar = "driverId" } # fallback; still better than hardcoding a literal

$statuses = '["assigned","accepted","on_the_way","arrived","on_trip"]'

# Find first ".from('bookings').select(...)" chain (single match)
# We patch ONLY the first one (active-trip should only query bookings once).
$pattern = "(?is)\.from\(\s*['""]bookings['""]\s*\)\s*\.\s*select\(\s*[\s\S]*?\)"
$m = [regex]::Match($txt, $pattern)

if (-not $m.Success) {
  Write-Host "[NO CHANGE] Could not find a .from('bookings').select(...) chain in: $target" -ForegroundColor Red
  Write-Host "Paste/upload the file and I'll patch exact anchors." -ForegroundColor Yellow
  throw "No changes applied."
}

$chunk = $m.Value

# Do NOT duplicate if already present
$hasDriverEq = ($chunk -match "\.eq\(\s*['""]driver_id['""]\s*,")
$hasStatusIn = ($chunk -match "\.in\(\s*['""]status['""]\s*,")

if ($hasDriverEq -and $hasStatusIn) {
  Write-Host "[OK] Filters already present in bookings query. No change needed." -ForegroundColor Green
  exit 0
}

# Inject missing filters right after the select(...)
$inject = ""
if (-not $hasDriverEq) { $inject += "`r`n      .eq(`"driver_id`", $driverVar)" }
if (-not $hasStatusIn) { $inject += "`r`n      .in(`"status`", $statuses)" }

$patchedChunk = $chunk + $inject

# Replace only this first chunk
$txt2 = $txt.Substring(0, $m.Index) + $patchedChunk + $txt.Substring($m.Index + $m.Length)

Write-Utf8NoBom $target $txt2
Write-Host "[DONE] Injected filters into bookings query in: $target" -ForegroundColor Green
Write-Host ("       driver var: {0}" -f $driverVar) -ForegroundColor Green
Write-Host ("       statuses  : {0}" -f $statuses) -ForegroundColor Green
