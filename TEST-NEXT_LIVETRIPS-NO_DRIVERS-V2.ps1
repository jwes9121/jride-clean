# TEST-NEXT_LIVETRIPS-NO_DRIVERS-V2.ps1
# Purpose: Test LiveTrips "revert" + page-data stability + status actions even with NO active drivers.
# Supports page-data shapes:
#  1) { bookings: [] } / { trips: [] } / { data: [] }
#  2) [] (array)
#  3) { "0": {...}, "1": {...}, ..., "zones": {...} }  <-- your current output

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

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

function Extract-Rows($page) {
  # Case 2: raw array
  if ($page -is [System.Collections.IEnumerable] -and $page -isnot [string] -and $page.GetType().Name -match 'Object\[\]') {
    return @($page)
  }

  # Case 1: wrapper keys
  foreach ($k in @("bookings","trips","data")) {
    if ($page -and ($page.PSObject.Properties.Name -contains $k)) {
      $v = $page.$k
      if ($v -is [System.Collections.IEnumerable] -and $v -isnot [string]) {
        return @($v)
      }
    }
  }

  # Case 3: numeric-key object => collect 0..N
  if ($page -and $page.PSObject -and $page.PSObject.Properties) {
    $numericProps = @($page.PSObject.Properties |
      Where-Object { $_.Name -match '^\d+$' } |
      Sort-Object { [int]$_.Name })

    if ($numericProps.Count -gt 0) {
      $rows = @()
      foreach ($p in $numericProps) { $rows += @($p.Value) }
      return $rows
    }
  }

  return @()
}

Write-Host "==[1/5] Fetch page-data..." -ForegroundColor Cyan
$page1 = Get-Json "$Base/api/admin/livetrips/page-data"

$rows = Extract-Rows $page1
if ($rows.Count -eq 0) {
  $keys = @()
  if ($page1 -and $page1.PSObject -and $page1.PSObject.Properties) {
    $keys = @($page1.PSObject.Properties.Name)
  }
  Fail ("page-data did not contain recognizable rows. Keys found: " + ($keys -join ", "))
}

# Keep only objects that have booking_code
$rows = @($rows | Where-Object { $_ -and $_.booking_code })
if ($rows.Count -eq 0) {
  Fail "Rows were found but none contained booking_code."
}

Write-Host ("Found {0} rows with booking_code." -f $rows.Count) -ForegroundColor Green

# Choose a completed/cancelled-like booking first; else fallback to first row.
$pick = @($rows | Where-Object { $_.status -match 'completed|cancel|done|finished' } | Select-Object -First 1)
if ($pick.Count -eq 0) { $pick = @($rows | Select-Object -First 1) }

$bookingCode = [string]$pick[0].booking_code
$oldStatus   = [string]$pick[0].status

Write-Host "==[2/5] Picked booking_code: $bookingCode (status: $oldStatus)" -ForegroundColor Cyan

# Try a likely active status. If your system uses a different value, change here:
$newStatus = "ongoing"

Write-Host "==[3/5] POST /api/dispatch/status => $newStatus" -ForegroundColor Cyan
$resp = Post-Json "$Base/api/dispatch/status" @{ bookingCode = $bookingCode; status = $newStatus }

Write-Host "Status response:" -ForegroundColor DarkGray
$resp | ConvertTo-Json -Depth 8

Write-Host "==[4/5] Refetch page-data to verify it sticks (no revert)..." -ForegroundColor Cyan
Start-Sleep -Milliseconds 500
$page2 = Get-Json "$Base/api/admin/livetrips/page-data"

$rows2 = Extract-Rows $page2
$rows2 = @($rows2 | Where-Object { $_ -and $_.booking_code })

$match = @($rows2 | Where-Object { $_.booking_code -eq $bookingCode } | Select-Object -First 1)
if ($match.Count -eq 0) {
  Write-Host "WARNING: booking_code not found after update. page-data may filter out this status." -ForegroundColor Yellow
  Write-Host "Try changing `$newStatus to 'assigned' or 'accepted' and rerun." -ForegroundColor Yellow
  exit 0
}

$seenStatus = [string]$match[0].status
Write-Host "==[5/5] After refresh: $bookingCode status is now: $seenStatus" -ForegroundColor Cyan

if ($seenStatus -ne $newStatus) {
  Write-Host "FAIL: It reverted (expected '$newStatus', got '$seenStatus')." -ForegroundColor Red
  Write-Host ""
  Write-Host "Matched booking object:" -ForegroundColor DarkGray
  $match[0] | ConvertTo-Json -Depth 10
} else {
  Write-Host "PASS: Status stuck correctly (no revert)." -ForegroundColor Green
}
