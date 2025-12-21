# PATCH-LIVETRIPSCLIENT-FIX-SINGLE-SMARTAUTOASSIGN.ps1
# Replaces the remaining SmartAutoAssignSuggestions call that is missing props.
# Exact line replacement — no regex guessing.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$lines = Get-Content -Path $f -Encoding UTF8

$old = '<SmartAutoAssignSuggestions trip={selectedTrip as any} drivers={drivers as any} />'

$replacement = @(
'<SmartAutoAssignSuggestions',
'  trip={selectedTrip as any}',
'  drivers={drivers as any}',
'  zoneStats={zoneStats as any}',
'  onAssign={(driverId: string) => {',
'    const bc = (selectedTrip as any)?.booking_code || (selectedTrip as any)?.bookingCode;',
'    if (!bc) return;',
'    return assignDriver(String(bc), String(driverId));',
'  }}',
'/>'
)

$found = $false
$out = foreach ($line in $lines) {
  if ($line.Trim() -eq $old) {
    $found = $true
    $replacement
  } else {
    $line
  }
}

if (-not $found) {
  Fail "Did not find the exact SmartAutoAssignSuggestions line to replace. Paste lines 585–605 of LiveTripsClient.tsx."
}

Set-Content -Path $f -Value $out -Encoding UTF8
Write-Host "OK: Replaced the remaining SmartAutoAssignSuggestions call with required props." -ForegroundColor Green
Write-Host "Next: npm run build" -ForegroundColor Cyan
