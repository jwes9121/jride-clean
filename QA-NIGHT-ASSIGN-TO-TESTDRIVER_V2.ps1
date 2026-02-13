# QA-NIGHT-ASSIGN-TO-TESTDRIVER_V2.ps1
$BASE = "https://app.jride.net"
$DRIVER = "00000000-0000-4000-8000-000000000001"

# Put a fixed test device id here. NOTE: if DEVICE_LOCKED returns a different active_device_id,
# we will retry using the active one.
$DEVICE = "TEST0001TEST0001"

# Change town/coords as you like (for dispatch filters)
$TOWN = "Hingyon"
$LAT  = 16.805
$LNG  = 121.095

function ToJson($obj) { $obj | ConvertTo-Json -Depth 20 }

function Invoke-PostJsonAllow409($url, $payload) {
  try {
    $r = Invoke-RestMethod -Method POST -Uri $url -ContentType "application/json" -Body (ToJson $payload)
    return [pscustomobject]@{ ok=$true; code=200; body=$r; raw=$null }
  } catch {
    $resp = $_.Exception.Response
    $code = if ($resp) { [int]$resp.StatusCode } else { -1 }
    $raw  = $null
    try {
      if ($resp -and $resp.GetResponseStream()) {
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $raw = $sr.ReadToEnd()
        $sr.Close()
      }
    } catch {}
    $body = $null
    try { if ($raw) { $body = $raw | ConvertFrom-Json } } catch {}
    return [pscustomobject]@{ ok=$false; code=$code; body=$body; raw=$raw }
  }
}

function Invoke-GetJson($url) {
  return Invoke-RestMethod -Method GET -Uri $url
}

Write-Host "[STEP 0] Base=$BASE" -ForegroundColor Cyan
Write-Host "[STEP 0] Driver=$DRIVER" -ForegroundColor Cyan

# STEP 1: Ping ONLINE (auto-handle DEVICE_LOCKED)
Write-Host "`n[STEP 1] Ping driver ONLINE..." -ForegroundColor Cyan
$payload = @{
  driver_id = $DRIVER
  lat       = $LAT
  lng       = $LNG
  status    = "online"
  town      = $TOWN
  device_id = $DEVICE
}

$ping = Invoke-PostJsonAllow409 "$BASE/api/driver/location/ping" $payload

if (!$ping.ok -and $ping.code -eq 409 -and $ping.body -and $ping.body.code -eq "DEVICE_LOCKED" -and $ping.body.active_device_id) {
  $active = "" + $ping.body.active_device_id
  Write-Host "[WARN] DEVICE_LOCKED -> retrying with active_device_id=$active" -ForegroundColor Yellow
  $payload.device_id = $active
  $ping = Invoke-PostJsonAllow409 "$BASE/api/driver/location/ping" $payload
}

if (!$ping.ok) {
  Write-Host "[FAIL] Ping failed HTTP=$($ping.code)" -ForegroundColor Red
  if ($ping.raw) { Write-Host $ping.raw -ForegroundColor DarkRed }
  throw "Cannot proceed. Fix device lock / ping first."
}

$finalDevice = "" + ($ping.body.active_device_id)
Write-Host "[OK] Driver online. active_device_id=$finalDevice" -ForegroundColor Green

# STEP 2: Load dispatch bookings
Write-Host "`n[STEP 2] Fetch /api/dispatch/bookings ..." -ForegroundColor Cyan
$bk = Invoke-GetJson "$BASE/api/dispatch/bookings"

if (!$bk -or $bk.ok -ne $true) { throw "dispatch/bookings returned not-ok" }

$rows = @()
if ($bk.rows) { $rows = @($bk.rows) }
elseif ($bk.data) { $rows = @($bk.data) }
elseif ($bk.bookings) { $rows = @($bk.bookings) }

if (!$rows -or $rows.Count -lt 1) {
  throw "No bookings returned by dispatch endpoint."
}

# STEP 3: Choose candidate booking
Write-Host "[STEP 3] Selecting a candidate booking..." -ForegroundColor Cyan

# Prefer pending first; then assigned with no driver_id; else latest
$cand =
  ($rows | Where-Object { (""+$_.status).ToLower() -eq "pending" } | Select-Object -First 1)

if (-not $cand) {
  $cand = ($rows | Where-Object {
    (""+$_.status).ToLower() -eq "assigned" -and ([string]::IsNullOrWhiteSpace(""+$_.driver_id))
  } | Select-Object -First 1)
}

if (-not $cand) { $cand = $rows | Select-Object -First 1 }

$bookingId = "" + $cand.id
$bookingCode = ""
if ($cand.booking_code) { $bookingCode = "" + $cand.booking_code }
elseif ($cand.code) { $bookingCode = "" + $cand.code }

Write-Host "[OK] Candidate bookingId=$bookingId bookingCode=$bookingCode status=$($cand.status) town=$($cand.town)" -ForegroundColor Green

# STEP 4: Assign it to test driver
Write-Host "`n[STEP 4] POST /api/dispatch/assign ..." -ForegroundColor Cyan
$assignPayload = @{
  booking_id = $bookingId
  driver_id  = $DRIVER
}

# include booking_code if present (some backends accept either)
if ($bookingCode.Trim().Length -gt 0) { $assignPayload.booking_code = $bookingCode }

$assign = Invoke-PostJsonAllow409 "$BASE/api/dispatch/assign" $assignPayload
if (!$assign.ok) {
  Write-Host "[FAIL] assign failed HTTP=$($assign.code)" -ForegroundColor Red
  if ($assign.raw) { Write-Host $assign.raw -ForegroundColor DarkRed }
  throw "Assign failed."
}

Write-Host "[OK] Assigned. Response ok." -ForegroundColor Green

# STEP 5: Confirm driver sees active trip
Write-Host "`n[STEP 5] GET /api/driver/active-trip ..." -ForegroundColor Cyan
$at = Invoke-GetJson "$BASE/api/driver/active-trip?driver_id=$DRIVER"

$note = if ($at.note) { $at.note } else { "" }
Write-Host "[OK] active-trip ok=$($at.ok) note=$note status=$($at.trip.status)" -ForegroundColor Green

Write-Host "`n[DONE] If your Android driver app is open with this driverId, it should show Assigned Trip now." -ForegroundColor Green
Write-Host "       IMPORTANT: Use device_id=$finalDevice for this driver when testing from desktop." -ForegroundColor Yellow
