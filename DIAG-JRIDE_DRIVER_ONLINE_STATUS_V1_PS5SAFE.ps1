param(
  [Parameter(Mandatory=$true)]
  [string]$BaseUrl,

  [Parameter(Mandatory=$true)]
  [string]$DriverId
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Fail([string]$m) { Write-Host $m -ForegroundColor Red; exit 1 }
function Ok([string]$m)   { Write-Host $m -ForegroundColor Green }
function Warn([string]$m) { Write-Host $m -ForegroundColor Yellow }

Write-Host "== JRIDE DIAG: Driver online status (V1 / PS5-safe) =="

$BaseUrl = $BaseUrl.TrimEnd("/")
$u = "$BaseUrl/api/admin/driver_locations"

Write-Host ("GET {0}" -f $u)

try {
  $res = Invoke-RestMethod -Method GET -Uri $u -Headers @{ "Cache-Control" = "no-store" }
} catch {
  Fail ("[FAIL] Request failed: {0}" -f $_.Exception.Message)
}

if (-not $res) { Fail "[FAIL] Empty response." }
if (-not $res.rows) { Fail "[FAIL] Response has no .rows (unexpected shape)." }

$row = $null
foreach ($r in $res.rows) {
  if (($r.driver_id -eq $DriverId) -or ($r.id -eq $DriverId)) { $row = $r; break }
}

if (-not $row) {
  Fail ("[FAIL] Driver not found in rows: {0}" -f $DriverId)
}

$updatedRaw = $row.updated_at
if (-not $updatedRaw) { Warn "[WARN] Row has no updated_at. Server can’t compute online freshness."; $updatedRaw = "" }

# Parse updated_at (handles Z/offset if present)
$updated = $null
if ($updatedRaw) {
  try {
    $updated = [DateTimeOffset]::Parse($updatedRaw)
  } catch {
    Warn ("[WARN] Could not parse updated_at as DateTimeOffset: {0}" -f $updatedRaw)
  }
}

$now = [DateTimeOffset]::UtcNow
$ageSec = $null
if ($updated) {
  $ageSec = [int]([Math]::Floor(($now - $updated).TotalSeconds))
}

Write-Host ""
Write-Host "---- DRIVER ROW ----" -ForegroundColor Cyan
Write-Host ("driver_id : {0}" -f ($row.driver_id))
Write-Host ("status    : {0}" -f ($row.status))
Write-Host ("town      : {0}" -f ($row.town))
Write-Host ("lat,lng   : {0}, {1}" -f ($row.lat), ($row.lng))
Write-Host ("updated_at: {0}" -f $updatedRaw)
if ($ageSec -ne $null) {
  Write-Host ("age_sec   : {0}" -f $ageSec)
}

Write-Host ""
Ok "[DONE] If age_sec is large (e.g. > 120s/180s), backend will mark OFFLINE even if Android says online."