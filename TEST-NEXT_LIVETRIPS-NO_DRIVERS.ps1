# TEST-NEXT_LIVETRIPS-NO_DRIVERS.ps1
# Purpose: Test LiveTrips "revert" + page-data stability + status actions even with NO active drivers.
# It:
# 1) Fetches /api/admin/livetrips/page-data
# 2) Picks a candidate booking_code from completed/cancelled (or any if needed)
# 3) Forces it into an "active" status via /api/dispatch/status
# 4) Refetches page-data to verify it STICKS (no revert)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

# Change if needed:
$Base = "http://localhost:3000"

function Get-Json($url) {
  try {
    return Invoke-RestMethod -Method GET -Uri $url -Headers @{ "Cache-Control"="no-cache" }
  } catch {
    Fail "GET failed: $url`n$($_.Exception.Message)"
  }
}

function Post-Json($url, $body) {
  try {
    return Invoke-RestMethod -Method POST -Uri $url -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 10)
  } catch {
    $msg = $_.Exception.Message
    try {
      $r = $_.Exception.Response
      if ($r) {
        $sr = New-Object System.IO.StreamReader($r.GetResponseStream())
        $text = $sr.ReadToEnd()
        $msg = "$msg`n---- body ----`n$text"
      }
    } catch {}
    Fail "POST failed: $url`n$msg"
  }
}

Write-Host "==[1/5] Fetch page-data..." -ForegroundColor Cyan
$page1 = Get-Json "$Base/api/admin/livetrips/page-data"

# Try multiple common shapes (we don't assume exact RPC output)
# Candidate arrays: bookings, trips, data
$candidates = @()
foreach ($k in @("bookings","trips","data")) {
  if ($page1.PSObject.Properties.Name -contains $k) {
    $v = $page1.$k
    if ($v -is [System.Collections.IEnumerable] -and $v -isnot [string]) {
      $candidates += @($v)
    }
  }
}

if ($candidates.Count -eq 0) {
  Fail "page-data did not contain bookings/trips/data arrays. Keys found: $(@($page1.PSObject.Properties.Name) -join ', ')"
}

# Flatten first array that has objects with booking_code
$rows = @()
foreach ($arr in $candidates) {
  $tmp = @($arr) | Where-Object { $_ -and $_.booking_code }
  if ($tmp.Count -gt 0) { $rows = $tmp; break }
}

if ($rows.Count -eq 0) {
  Fail "No rows with booking_code found in page-data arrays. Keys on first element (if any) may differ."
}

Write-Host ("Found {0} rows with booking_code." -f $rows.Count) -ForegroundColor Green

# Choose a completed/cancelled-like booking first; else fallback to first row.
$pick =
  ($rows | Where-Object { $_.status -match 'completed|cancel|done|finished' } | Select-Object -First 1)

if (-not $pick) { $pick = $rows | Select-Object -First 1 }

$bookingCode = [string]$pick.booking_code
$oldStatus = [string]$pick.status

Write-Host "==[2/5] Picked booking_code: $bookingCode (status: $oldStatus)" -ForegroundColor Cyan

# Choose an "active" status to set.
# We don't know your canonical active statuses, but 'ongoing' is commonly used in your setup.
# If your UI expects 'in_progress', change it here.
$newStatus = "ongoing"

Write-Host "==[3/5] POST /api/dispatch/status => $newStatus" -ForegroundColor Cyan
$resp = Post-Json "$Base/api/dispatch/status" @{ bookingCode = $bookingCode; status = $newStatus }

Write-Host "Status response:" -ForegroundColor DarkGray
$resp | ConvertTo-Json -Depth 6

Write-Host "==[4/5] Refetch page-data to verify it sticks (no revert)..." -ForegroundColor Cyan
Start-Sleep -Milliseconds 500
$page2 = Get-Json "$Base/api/admin/livetrips/page-data"

# Find the row again
$rows2 = @()
foreach ($k in @("bookings","trips","data")) {
  if ($page2.PSObject.Properties.Name -contains $k) {
    $v = $page2.$k
    if ($v -is [System.Collections.IEnumerable] -and $v -isnot [string]) {
      $rows2 += @($v)
    }
  }
}

$match = @($rows2 | Where-Object { $_ -and $_.booking_code -eq $bookingCode } | Select-Object -First 1)
if (-not $match) {
  Write-Host "WARNING: booking_code not found after update. This means page-data RPC filters it out now." -ForegroundColor Yellow
  Write-Host "Try setting status to 'assigned' or 'accepted' instead of 'ongoing'." -ForegroundColor Yellow
  exit 0
}

$seenStatus = [string]$match.status
Write-Host "==[5/5] After refresh: $bookingCode status is now: $seenStatus" -ForegroundColor Cyan

if ($seenStatus -ne $newStatus) {
  Write-Host "FAIL: It reverted (expected '$newStatus', got '$seenStatus')." -ForegroundColor Red
  Write-Host "Next: paste these two JSON snippets to me:" -ForegroundColor Yellow
  Write-Host "1) The status route response above" -ForegroundColor Yellow
  Write-Host "2) The matched booking object from page-data after refresh" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Matched booking object:" -ForegroundColor DarkGray
  $match | ConvertTo-Json -Depth 8
} else {
  Write-Host "PASS: Status stuck correctly (no revert)." -ForegroundColor Green
  Write-Host "Now we can test ASSIGN next (even without drivers) by sending a dummy UUID." -ForegroundColor Green
}
