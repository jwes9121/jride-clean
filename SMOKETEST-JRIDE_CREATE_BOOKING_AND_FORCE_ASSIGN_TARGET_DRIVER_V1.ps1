# SMOKETEST-JRIDE_CREATE_BOOKING_AND_FORCE_ASSIGN_TARGET_DRIVER_V1.ps1
# PowerShell 5.1 safe (no ??, no PS7-only syntax)
#
# Purpose:
# - Create a booking directly via PROD public endpoint (bypasses passenger UI geo restriction)
# - Force-assign it to a specific driver UUID
# - Poll /api/driver/active-trip to confirm the driver has the assigned trip
#
# Target driver:
# d41bf199-96c6-4022-8a3d-09ab9dbd270f

$ErrorActionPreference = "Stop"

# =========================
# CONFIG (EDIT IF NEEDED)
# =========================
$BASE_URL        = "https://app.jride.net"

$TOWN            = "Hingyon"
$PASSENGER_NAME  = "SmokeTest Passenger"
$PASSENGER_COUNT = 1

# Use Hingyon coordinates (from your smoke test doc)
$PICKUP_LAT  = 16.88
$PICKUP_LNG  = 121.13
$DROPOFF_LAT = 16.882
$DROPOFF_LNG = 121.135

# Most likely required by your passenger book endpoint:
$VEHICLE_TYPE = "tricycle"   # keep as "tricycle" unless your endpoint uses different naming

$TARGET_DRIVER_ID = "d41bf199-96c6-4022-8a3d-09ab9dbd270f"

# Poll settings
$POLL_SECONDS      = 60
$POLL_INTERVAL_MS  = 2000

# =========================
# END CONFIG
# =========================

$CREATE_URL = ($BASE_URL.TrimEnd("/") + "/api/public/passenger/book")
$ASSIGN_URL = ($BASE_URL.TrimEnd("/") + "/api/dispatch/assign")
$DRIVER_ACTIVE_TRIP_URL = ($BASE_URL.TrimEnd("/") + "/api/driver/active-trip?driver_id=" + [uri]::EscapeDataString($TARGET_DRIVER_ID))

function Ok([string]$m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail([string]$m) { Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }

function PostJson([string]$url, [hashtable]$bodyObj) {
  $json = $bodyObj | ConvertTo-Json -Depth 50
  return Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body $json
}

function GetJson([string]$url) {
  return Invoke-RestMethod -Method Get -Uri $url -Headers @{ "cache-control"="no-cache" }
}

function HasProp([object]$o, [string]$p) {
  return ($null -ne $o -and $null -ne $o.PSObject -and $null -ne $o.PSObject.Properties[$p])
}

Write-Host "== JRIDE SMOKETEST: Create booking (Hingyon) + Force-assign to target driver ==" -ForegroundColor Cyan
Ok "BASE_URL: $BASE_URL"
Ok "Create endpoint: $CREATE_URL"
Ok "Assign endpoint:  $ASSIGN_URL"
Ok "Driver active:    $DRIVER_ACTIVE_TRIP_URL"
Ok "Target driver:    $TARGET_DRIVER_ID"
Ok ("Town: " + $TOWN + " | Vehicle: " + $VEHICLE_TYPE + " | Pax: " + $PASSENGER_COUNT)
Ok ("Pickup:  " + $PICKUP_LAT + ", " + $PICKUP_LNG)
Ok ("Dropoff: " + $DROPOFF_LAT + ", " + $DROPOFF_LNG)

# -------------------------
# Step 1: Create booking
# -------------------------
Write-Host "`n== Step 1/3: Create booking ==" -ForegroundColor Cyan

# Body: keep it simple but include the obvious required fields
$createBody = @{
  town            = $TOWN
  passenger_name  = $PASSENGER_NAME
  passenger_count = $PASSENGER_COUNT
  pickup_lat      = $PICKUP_LAT
  pickup_lng      = $PICKUP_LNG
  dropoff_lat     = $DROPOFF_LAT
  dropoff_lng     = $DROPOFF_LNG
  vehicle_type    = $VEHICLE_TYPE
}

$createResp = $null
try {
  $createResp = PostJson -url $CREATE_URL -bodyObj $createBody
} catch {
  Fail ("Booking create FAILED: " + $_.Exception.Message)
}

# Validate response
if (-not (HasProp $createResp "ok") -or (-not $createResp.ok)) {
  Write-Host "[DEBUG] Create response:" -ForegroundColor Yellow
  $createResp | ConvertTo-Json -Depth 50 | Write-Host
  Fail "Create endpoint returned ok=false or missing ok."
}

$bookingCode = $null
if (HasProp $createResp "booking_code") { $bookingCode = $createResp.booking_code }
elseif (HasProp $createResp "bookingCode") { $bookingCode = $createResp.bookingCode }

if (-not $bookingCode) {
  Write-Host "[DEBUG] Create response:" -ForegroundColor Yellow
  $createResp | ConvertTo-Json -Depth 50 | Write-Host
  Fail "Could not extract booking_code from create response."
}

Ok "Created booking_code: $bookingCode"

# -------------------------
# Step 2: Force-assign booking to target driver
# -------------------------
Write-Host "`n== Step 2/3: Force-assign to target driver ==" -ForegroundColor Cyan

$assignBody = @{
  bookingCode = $bookingCode
  driverId    = $TARGET_DRIVER_ID
}

$assignResp = $null
try {
  $assignResp = PostJson -url $ASSIGN_URL -bodyObj $assignBody
} catch {
  Fail ("Assign FAILED: " + $_.Exception.Message)
}

# We won't over-assume response shape; just dump a short confirmation.
Ok "Assign POST completed."
Write-Host "[Assign Response]" -ForegroundColor DarkGray
$assignResp | ConvertTo-Json -Depth 50 | Write-Host

# -------------------------
# Step 3: Poll driver active-trip until it shows the booking
# -------------------------
Write-Host "`n== Step 3/3: Verify driver sees active trip ==" -ForegroundColor Cyan

$deadline = (Get-Date).AddSeconds($POLL_SECONDS)
$last = $null
$found = $false

while ((Get-Date) -lt $deadline) {
  try {
    $last = GetJson -url $DRIVER_ACTIVE_TRIP_URL
  } catch {
    Start-Sleep -Milliseconds $POLL_INTERVAL_MS
    continue
  }

  # Expect shape: { ok:true, driver_id, trip:{...} or trip:null }
  if ($last -and (HasProp $last "trip") -and $last.trip -ne $null) {
    # trip has fields: id, town, status, assigned_driver_id
    $trip = $last.trip

    # We match by: assigned_driver_id == target OR status in active statuses AND town matches.
    $status = $null
    if (HasProp $trip "status") { $status = $trip.status }

    $town = $null
    if (HasProp $trip "town") { $town = $trip.town }

    # If your trip object doesn’t include booking_code, we just confirm driver has ANY active trip after assign.
    # But we print full object so you can see id/status.
    if ($town -eq $TOWN) {
      $found = $true
      Ok ("ACTIVE TRIP FOUND for driver. status=" + $status + " town=" + $town)
      Write-Host "[Trip Object]" -ForegroundColor DarkGray
      $trip | ConvertTo-Json -Depth 50 | Write-Host
      break
    }
  }

  Start-Sleep -Milliseconds $POLL_INTERVAL_MS
}

if (-not $found) {
  Warn "Driver active-trip still shows trip:null (or not matching) after polling."
  Write-Host "[Last Active-Trip Response]" -ForegroundColor DarkGray
  if ($last) { $last | ConvertTo-Json -Depth 50 | Write-Host }
  Fail "Assignment did not reflect as an active trip for the driver within the poll window."
}

Write-Host "`n=== RESULT ===" -ForegroundColor Green
Write-Host "Booking created on PROD and force-assigned to target driver: $TARGET_DRIVER_ID" -ForegroundColor Green
Write-Host "Next: ask driver to open the app and screenshot the incoming booking screen." -ForegroundColor Green
Write-Host ("Booking code: " + $bookingCode) -ForegroundColor Green
