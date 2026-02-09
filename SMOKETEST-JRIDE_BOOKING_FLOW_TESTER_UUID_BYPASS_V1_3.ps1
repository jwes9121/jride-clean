# SMOKETEST-JRIDE_BOOKING_FLOW_TESTER_UUID_BYPASS_V1_3.ps1
# PS5-safe.
# Focuses on passenger ride booking route and sends robust GEO fields to satisfy GEO_REQUIRED.

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host $m -ForegroundColor Red; exit 1 }

function Nz([object]$v, [string]$fallback) {
  if ($null -eq $v) { return $fallback }
  $s = [string]$v
  if ([string]::IsNullOrWhiteSpace($s)) { return $fallback }
  return $s
}

$BaseUrl = $env:JRIDE_BASE_URL
if ([string]::IsNullOrWhiteSpace($BaseUrl)) { $BaseUrl = "https://app.jride.net" }

$TesterDriverId = "00000000-0000-4000-8000-000000000001"
$AdminToken = $env:JRIDE_ADMIN_TOKEN

# Lamut-ish coords
$PickupLat  = 16.7369
$PickupLng  = 121.1526
$DropLat    = 16.6930
$DropLng    = 121.1740

function InvokeJson([string]$method, [string]$url, [object]$body){
  $headers = @{
    "Content-Type" = "application/json"
    "x-jride-test" = "1"
    "x-jride-bypass-wallet" = "1"
    "x-jride-bypass-night-gate" = "1"
    "x-jride-bypass-location" = "1"
  }
  if (-not [string]::IsNullOrWhiteSpace($AdminToken)) {
    $headers["Authorization"] = ("Bearer " + $AdminToken)
  }

  $json = $null
  if ($body -ne $null) { $json = ($body | ConvertTo-Json -Depth 12) }

  try {
    if ($method -eq "GET") {
      return Invoke-RestMethod -Method Get -Uri $url -Headers $headers -TimeoutSec 30
    } else {
      return Invoke-RestMethod -Method $method -Uri $url -Headers $headers -Body $json -TimeoutSec 30
    }
  } catch {
    $resp = $_.Exception.Response
    if ($resp -and $resp.GetResponseStream()) {
      $sr = New-Object IO.StreamReader($resp.GetResponseStream())
      $txt = $sr.ReadToEnd()
      Warn "[HTTP ERROR BODY]"
      Write-Host $txt
      return $null
    }
    throw
  }
}

Info "== JRIDE SmokeTest V1.3: Booking -> Assign -> Accept (Tester UUID) =="
Info ("BaseUrl: " + $BaseUrl)
Info ("TesterDriverId: " + $TesterDriverId)

# Hard-prefer the known passenger booking endpoint
$bookUrl = $BaseUrl + "/api/public/passenger/book"
Info ("== Creating booking at: " + $bookUrl)

# Send robust geo variants + pickup/dropoff variants
$body = @{
  test_mode = $true
  bypass_wallet = $true
  bypass_night_gate = $true
  bypass_location = $true

  town = "Lamut"
  service = "ride"
  notes = "SMOKETEST V1.3 GEO_REQUIRED bypass: tester uuid + headers"

  # Current device geo variants (often required)
  lat = $PickupLat
  lng = $PickupLng
  current_lat = $PickupLat
  current_lng = $PickupLng
  geo = @{ lat = $PickupLat; lng = $PickupLng }

  # Pickup/dropoff nested
  pickup = @{ lat = $PickupLat; lng = $PickupLng; label = "Lamut (test pickup)" }
  dropoff = @{ lat = $DropLat; lng = $DropLng; label = "Lamut (test dropoff)" }

  # Pickup/dropoff flat variants (some routes expect these)
  pickup_lat = $PickupLat
  pickup_lng = $PickupLng
  dropoff_lat = $DropLat
  dropoff_lng = $DropLng
  pickup_label = "Lamut (test pickup)"
  dropoff_label = "Lamut (test dropoff)"
}

$createRes = InvokeJson -method "POST" -url $bookUrl -body $body
if ($null -eq $createRes) { Die "[FAIL] Booking create failed (see HTTP ERROR BODY above)." }

Info ($createRes | ConvertTo-Json -Depth 12)

# Extract booking id/code
$bookingId = $null
$bookingCode = $null
foreach ($k in @("booking_id","id","bookingId")) {
  if ($createRes.PSObject.Properties.Name -contains $k) { $bookingId = [string]$createRes.$k; break }
}
foreach ($k in @("booking_code","code","bookingCode")) {
  if ($createRes.PSObject.Properties.Name -contains $k) { $bookingCode = [string]$createRes.$k; break }
}
if (-not $bookingId -and $createRes.booking) {
  $b = $createRes.booking
  if ($b.id) { $bookingId = [string]$b.id }
  if ($b.booking_code) { $bookingCode = [string]$b.booking_code }
}

if (-not $bookingId -and -not $bookingCode) {
  Die "[FAIL] Could not extract booking id/code from create response."
}

Ok ("[OK] bookingId: " + (Nz $bookingId "<null>"))
Ok ("[OK] bookingCode: " + (Nz $bookingCode "<null>"))

# Assign
$assignUrl = ($BaseUrl + "/api/dispatch/assign")
Info "== Assigning to tester driver =="
$assignRes = InvokeJson -method "POST" -url $assignUrl -body @{
  booking_id = $bookingId
  booking_code = $bookingCode
  driver_id = $TesterDriverId
  assigned_driver_id = $TesterDriverId
  test_mode = $true
}
if ($null -eq $assignRes) { Die "[FAIL] Assign failed (see HTTP ERROR BODY above)." }
Info ($assignRes | ConvertTo-Json -Depth 12)

# Status -> accepted
$statUrl = ($BaseUrl + "/api/dispatch/status")
Info "== Setting status -> accepted =="
$statRes = InvokeJson -method "POST" -url $statUrl -body @{
  booking_id = $bookingId
  booking_code = $bookingCode
  status = "accepted"
  test_mode = $true
}
if ($null -eq $statRes) { Die "[FAIL] dispatch/status failed (see HTTP ERROR BODY above)." }
Info ($statRes | ConvertTo-Json -Depth 12)

# Poll active-trip
$pollUrl = ($BaseUrl + "/api/driver/active-trip?driver_id=" + $TesterDriverId)
Info "== Polling active-trip (up to 10 tries) =="
for ($i=1; $i -le 10; $i++) {
  Start-Sleep -Seconds 2
  $poll = InvokeJson -method "GET" -url $pollUrl -body $null
  if ($null -eq $poll) { continue }
  $st = $null
  try { $st = [string]$poll.trip.status } catch { $st = $null }
  Info ("Try {0}: status={1}" -f $i, (Nz $st "<null>"))
  if ($st -eq "accepted") {
    Ok "[OK] Driver active-trip is ACCEPTED (correct)."
    break
  }
}

Ok "== SMOKETEST DONE =="
