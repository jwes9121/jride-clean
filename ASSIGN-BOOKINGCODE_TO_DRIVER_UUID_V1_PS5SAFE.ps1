# ASSIGN-BOOKINGCODE_TO_DRIVER_UUID_V1_PS5SAFE.ps1
# PS5-safe: Assign a known booking_code to a target driver UUID (and optionally sets status=assigned).

param(
  [string]$BaseUrl = "https://app.jride.net",
  [string]$BookingCode = "",
  [string]$DriverId = "d41bf199-96c6-4022-8a3d-09ab9dbd270f",
  [switch]$NoStatusCall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red }

function Invoke-PostJson {
  param([string]$Url, [hashtable]$Body)

  $json = ($Body | ConvertTo-Json -Depth 12)
  try {
    return Invoke-RestMethod -Method Post -Uri $Url -ContentType "application/json" -Body $json
  } catch {
    $msg = $_.Exception.Message
    try {
      $resp = $_.Exception.Response
      if ($resp -and $resp.GetResponseStream()) {
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $bodyText = $sr.ReadToEnd()
        if ($bodyText) { $msg = "$msg`n--- body ---`n$bodyText" }
      }
    } catch {}
    throw $msg
  }
}

Ok "== JRIDE: Assign booking_code to driver UUID (PS5-safe) =="
Ok ("BaseUrl  : {0}" -f $BaseUrl)
Ok ("DriverId : {0}" -f $DriverId)

if (-not $BookingCode -or $BookingCode.Trim().Length -eq 0) {
  $BookingCode = Read-Host "Paste booking_code"
}

$BookingCode = $BookingCode.Trim()
if ($BookingCode.Length -lt 4) {
  Fail "[FAIL] booking_code looks too short. Paste the real booking_code."
  exit 1
}

# Assign
$assignUrl = ($BaseUrl.TrimEnd("/") + "/api/dispatch/assign")
Ok ("== Calling /api/dispatch/assign bookingCode={0} driverId={1} ==" -f $BookingCode, $DriverId)
$assignRes = Invoke-PostJson -Url $assignUrl -Body @{
  bookingCode = $BookingCode
  driverId    = $DriverId
  source      = "ps-test"
}
Ok "[OK] /api/dispatch/assign response:"
($assignRes | ConvertTo-Json -Depth 12) | Write-Host

# Optional status call
if (-not $NoStatusCall) {
  $statusUrl = ($BaseUrl.TrimEnd("/") + "/api/dispatch/status")
  Ok ("== Calling /api/dispatch/status bookingCode={0} status=assigned ==" -f $BookingCode)
  try {
    $st = Invoke-PostJson -Url $statusUrl -Body @{ bookingCode = $BookingCode; status = "assigned" }
    Ok "[OK] /api/dispatch/status response:"
    ($st | ConvertTo-Json -Depth 12) | Write-Host
  } catch {
    Warn "[WARN] /api/dispatch/status failed (assign may already set status). Details:"
    Warn "$_"
  }
} else {
  Warn "Skipping /api/dispatch/status (-NoStatusCall set)."
}

Ok "== DONE =="
Ok "Now: Hingyon driver app > GO ONLINE. If it still doesn't pop, issue is driver polling / RLS."
