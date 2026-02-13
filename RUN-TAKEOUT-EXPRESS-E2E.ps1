param(
  [Parameter(Mandatory=$true)][string]$VendorId,
  [Parameter(Mandatory=$false)][string]$Town = "Lagawe",
  [Parameter(Mandatory=$false)][ValidateSet("regular","express")][string]$ServiceLevel = "express",
  [Parameter(Mandatory=$false)][string]$PickupLabel = "Vendor pickup",
  [Parameter(Mandatory=$false)][string]$DropoffLabel = "Customer dropoff"
)

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$base = "http://localhost:3000"

Write-Host "[1/3] Creating TAKEOUT booking via Dispatch API..." -ForegroundColor Cyan

# Body is intentionally minimal and schema-safe:
# The route will DROP fields that don't exist in your bookings table.
$bodyObj = @{
  service_type = "takeout"
  takeout_service_level = $ServiceLevel
  vendor_id = $VendorId
  town = $Town
  pickup_label = $PickupLabel
  dropoff_label = $DropoffLabel
}

$body = ($bodyObj | ConvertTo-Json -Depth 8)

try {
  $resp = Invoke-RestMethod "$base/api/dispatch/bookings" -Method Post -ContentType "application/json" -Body $body
} catch {
  Write-Host "[HTTP ERROR] Create failed:" -ForegroundColor Red
  if ($_.Exception.Response -and $_.Exception.Response.GetResponseStream()) {
    $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $errBody = $sr.ReadToEnd()
    $sr.Close()
    Write-Host $errBody -ForegroundColor Yellow
  } else {
    Write-Host $_.Exception.Message -ForegroundColor Yellow
  }
  throw
}

$row = $resp.row
if (-not $row) { Fail "No 'row' returned from API. Response: $($resp | ConvertTo-Json -Depth 6)" }

$bookingCode = $row.booking_code
$id = $row.id

Write-Host "[OK] Created booking." -ForegroundColor Green
Write-Host "  id: $id" -ForegroundColor Gray
Write-Host "  booking_code: $bookingCode" -ForegroundColor Gray
Write-Host "  takeout_service_level: $ServiceLevel" -ForegroundColor Gray

Write-Host "`n[2/3] Verifying it appears in LiveTrips page-data..." -ForegroundColor Cyan
$pd = Invoke-RestMethod "$base/api/admin/livetrips/page-data" -Headers @{ "Cache-Control"="no-store" }

$trips = $null
if ($pd -and $pd.data -and ($pd.data.PSObject.Properties.Name -contains "trips")) {
  $trips = $pd.data.trips
}

if (-not $trips) {
  Write-Host "[WARN] page-data returned but 'data.trips' was empty/missing. Open /admin/livetrips manually." -ForegroundColor Yellow
  exit 0
}

$match = $trips | Where-Object { $_.booking_code -eq $bookingCode } | Select-Object -First 1
if ($match) {
  Write-Host "[OK] Found in LiveTrips trips list: $($match.booking_code)" -ForegroundColor Green
} else {
  Write-Host "[WARN] Not found in current LiveTrips payload (maybe filtered by status/tab). Open /admin/livetrips and check Dispatch tab." -ForegroundColor Yellow
}

Write-Host "`n[3/3] Where to see it in UI:" -ForegroundColor Cyan
Write-Host " - Dispatch Panel: http://localhost:3000/dispatch (queue list)" -ForegroundColor Gray
Write-Host " - LiveTrips: http://localhost:3000/admin/livetrips (Dispatch/Pending/Assigned tabs)" -ForegroundColor Gray
