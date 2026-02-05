# TEST-JRIDE_PING_ONLINE_AND_ASSIGN_V3.ps1
# - Pings driver online with lat/lng
# - If DEVICE_LOCKED, retries using the server-reported active_device_id
# - Then attempts to assign booking via /api/dispatch/assign (if available)
#   Otherwise prints the exact SQL you can run in Supabase.

$ErrorActionPreference = "Stop"

$BASE = "https://app.jride.net"
$DriverId  = "00000000-0000-4000-8000-000000000001"
$BookingId = "ee9beaaf-c4de-4995-8ad9-39baab3e8425"
$Town = "hingyon"

# coords from your earlier screenshots
$Lat = 16.85057
$Lng = 121.09951

# If you already know the correct device id, set it here.
# Your server says the active device is: 2e3b5a99759d0120
$DeviceId = "2e3b5a99759d0120"

Write-Host "[INFO] BASE: $BASE"
Write-Host "[INFO] Driver: $DriverId"
Write-Host "[INFO] Booking: $BookingId"
Write-Host "[INFO] Town: $Town"
Write-Host "[INFO] DeviceId (initial): $DeviceId"
Write-Host ""

function Invoke-JsonPost($Url, $Obj) {
  $json = ($Obj | ConvertTo-Json -Depth 10)
  try {
    return Invoke-RestMethod -Method Post -Uri $Url -ContentType "application/json" -Body $json
  } catch {
    $resp = $_.Exception.Response
    if ($resp -and $resp.GetResponseStream()) {
      $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $body = $sr.ReadToEnd()
      throw "[HTTP ERROR] $Url`nPayload: $json`nBody: $body"
    }
    throw
  }
}

# 1) Ping (with lat/lng + device_id)
$pingUrl = "$BASE/api/driver/location/ping"
$pingPayload = @{
  driver_id = $DriverId
  device_id = $DeviceId
  status    = "online"
  town      = $Town
  lat       = $Lat
  lng       = $Lng
}

Write-Host "[INFO] PING -> $pingUrl"
try {
  $pingResp = Invoke-JsonPost $pingUrl $pingPayload
  Write-Host "[OK] Ping response:" ($pingResp | ConvertTo-Json -Depth 10)
} catch {
  $msg = "$_"
  Write-Host $msg

  # If device locked, extract active_device_id and retry
  if ($msg -match '"code"\s*:\s*"DEVICE_LOCKED"' -and $msg -match '"active_device_id"\s*:\s*"([^"]+)"') {
    $activeDevice = $Matches[1]
    Write-Host "[WARN] DEVICE_LOCKED. Retrying with active_device_id=$activeDevice"
    $pingPayload.device_id = $activeDevice
    $DeviceId = $activeDevice

    $pingResp = Invoke-JsonPost $pingUrl $pingPayload
    Write-Host "[OK] Ping response (retry):" ($pingResp | ConvertTo-Json -Depth 10)
  } else {
    throw "Ping failed and was not DEVICE_LOCKED (see error above)."
  }
}

Write-Host ""
Write-Host "[OK] Using DeviceId: $DeviceId"
Write-Host ""

# 2) Assign booking to driver (try API first)
$assignUrl = "$BASE/api/dispatch/assign"
$assignPayload = @{
  booking_id = $BookingId
  driver_id  = $DriverId
}

Write-Host "[INFO] ASSIGN -> $assignUrl"
try {
  $assignResp = Invoke-JsonPost $assignUrl $assignPayload
  Write-Host "[OK] Assign response:" ($assignResp | ConvertTo-Json -Depth 10)
} catch {
  Write-Host "[WARN] Assign API failed (maybe auth-protected or route differs)."
  Write-Host "$_"
  Write-Host ""
  Write-Host "Run this SQL in Supabase instead:"
  Write-Host ""
  Write-Host "update public.bookings"
  Write-Host "set assigned_driver_id = '$DriverId', status = 'assigned'"
  Write-Host "where id = '$BookingId';"
  Write-Host ""
  Write-Host "select id, status, driver_id, assigned_driver_id, town, zone_id"
  Write-Host "from public.bookings"
  Write-Host "where id = '$BookingId';"
}

Write-Host ""
Write-Host "[DONE] Ping + assign finished."
