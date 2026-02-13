# FIX-JRIDE_CLEAR_DRIVER_ACTIVE_TRIP_LOOP_V1_1_PS5SAFE.ps1
# PowerShell 5.1 safe (NO ??, NO ?:)
#
# What it does:
# - GET /api/driver/active-trip?driver_id=...
# - If trip != null: POST /api/dispatch/status with booking_id (and booking_code if present) to cancel it
# - Repeat until trip becomes null (NO_ACTIVE_TRIP)

$ErrorActionPreference = "Stop"

# ===== CONFIG =====
$BASE_URL  = "https://app.jride.net"
$DRIVER_ID = "d41bf199-96c6-4022-8a3d-09ab9dbd270f"

$MAX_LOOPS = 8
$SLEEP_MS  = 1500
# ===== END CONFIG =====

$ACTIVE_URL = ($BASE_URL.TrimEnd("/") + "/api/driver/active-trip?driver_id=" + [uri]::EscapeDataString($DRIVER_ID))
$STATUS_URL = ($BASE_URL.TrimEnd("/") + "/api/dispatch/status")

function Ok([string]$m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail([string]$m) { Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }

function HasProp([object]$o, [string]$p) {
  return ($null -ne $o -and $null -ne $o.PSObject -and $null -ne $o.PSObject.Properties[$p])
}

function GetJson([string]$url) {
  $res = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $url -Headers @{
    "Accept"="application/json"
    "cache-control"="no-cache"
  }
  return ($res.Content | ConvertFrom-Json)
}

function PostStatus([hashtable]$bodyObj) {
  $json = $bodyObj | ConvertTo-Json -Depth 20
  try {
    $res = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $STATUS_URL -ContentType "application/json" -Body $json -Headers @{
      "Accept"="application/json"
      "cache-control"="no-cache"
    }
    return @{ ok=$true; status=[int]$res.StatusCode; body=$res.Content }
  } catch {
    $resp = $_.Exception.Response
    $code = $null
    $body = $null
    try {
      if ($resp -ne $null) {
        $code = [int]$resp.StatusCode.value__
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $body = $sr.ReadToEnd()
      }
    } catch {}
    return @{ ok=$false; status=$code; body=$body; err=$_.Exception.Message }
  }
}

Write-Host "== JRIDE FIX: Clear driver active trip loop (PS5-safe) ==" -ForegroundColor Cyan
Ok "BASE_URL:   $BASE_URL"
Ok "DRIVER_ID:  $DRIVER_ID"
Ok "ACTIVE_URL: $ACTIVE_URL"
Ok "STATUS_URL: $STATUS_URL"

for ($i = 1; $i -le $MAX_LOOPS; $i++) {
  Write-Host ""
  Write-Host ("== Loop " + $i + "/" + $MAX_LOOPS + " ==") -ForegroundColor Cyan

  $a = $null
  try {
    $a = GetJson $ACTIVE_URL
  } catch {
    Fail ("Active-trip GET failed: " + $_.Exception.Message)
  }

  if (-not $a -or -not (HasProp $a "trip") -or $null -eq $a.trip) {
    Ok "NO_ACTIVE_TRIP (trip=null). Done."
    exit 0
  }

  $trip = $a.trip

  $tripId = $null
  if (HasProp $trip "id") { $tripId = [string]$trip.id }

  $bookingCode = $null
  if (HasProp $trip "booking_code") { $bookingCode = [string]$trip.booking_code }
  elseif (HasProp $trip "bookingCode") { $bookingCode = [string]$trip.bookingCode }
  elseif (HasProp $trip "code") { $bookingCode = [string]$trip.code }

  $bcShow = "(none)"
  if ($bookingCode -and $bookingCode.Trim().Length -gt 0) { $bcShow = $bookingCode.Trim() }

  Ok ("Active trip found. trip.id=" + $tripId + " booking_code=" + $bcShow)

  if (-not $tripId -or $tripId.Trim().Length -eq 0) {
    Warn "Trip object has no id. Dumping active-trip response:"
    $a | ConvertTo-Json -Depth 50 | Write-Host
    Fail "Cannot cancel without trip.id (booking_id)."
  }

  $statuses = @("cancelled","canceled","cancelled_by_admin","cancelled_admin")
  $cleared = $false

  foreach ($st in $statuses) {
    $bodyObj = @{
      status     = $st
      driver_id  = $DRIVER_ID
      booking_id = $tripId
    }

    if ($bookingCode -and $bookingCode.Trim().Length -gt 0 -and $bookingCode.Trim() -ne "-") {
      $bodyObj["booking_code"] = $bookingCode.Trim()
    }

    Warn ("POST /dispatch/status => " + $st + " (booking_id=" + $tripId + ")")
    $r = PostStatus $bodyObj

    if ($r.ok) {
      Ok ("Status update accepted. HTTP " + $r.status)
      $cleared = $true
      break
    } else {
      Warn ("Rejected. HTTP " + $r.status + " err=" + $r.err)
      if ($r.body) { Write-Host $r.body }
    }
  }

  if (-not $cleared) {
    Fail "Could not clear trip via status endpoint. We need the exact status enum your backend accepts."
  }

  Start-Sleep -Milliseconds $SLEEP_MS
}

Fail "Max loops reached but trip still not cleared. Check active-trip again."
