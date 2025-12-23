# TEST-ASSIGN-VENDOR-TRIP.ps1
$ErrorActionPreference = "Stop"

$base = "http://localhost:3000"

# CHANGE THIS: paste the booking_code returned by SQL (TAKEOUT-UI-YYYYMMDD-HHMMSS)
$bookingCode = "TAKEOUT-UI-20251222-094650"

# Use the online driver from your dropdown (example below is the one you already tested)
$driverId = "ae0f7812-7d25-40bf-adca-a7e38615c144"

function Read-RawHttpError($err){
  if ($err.Exception.Response -and $err.Exception.Response.GetResponseStream()) {
    $sr = New-Object System.IO.StreamReader($err.Exception.Response.GetResponseStream())
    $raw = $sr.ReadToEnd()
    $sr.Close()
    return $raw
  }
  return $err.Exception.Message
}

Write-Host "[1/2] Assigning driver..." -ForegroundColor Cyan
$body = @{ bookingCode = $bookingCode; driverId = $driverId } | ConvertTo-Json

try {
  $res = Invoke-RestMethod -Method POST -Uri "$base/api/dispatch/assign" -ContentType "application/json" -Body $body
  Write-Host "[OK] Assign success" -ForegroundColor Green
  $res | ConvertTo-Json -Depth 10
} catch {
  Write-Host "[HTTP ERROR] Assign failed:" -ForegroundColor Yellow
  $raw = Read-RawHttpError $_
  Write-Host $raw
  Write-Host ""
  Write-Host "If you see BUSY_CHECK_FAILED, the driver is considered busy by the API." -ForegroundColor Yellow
  Write-Host "Pick another driver that shows 'online' (not 'on_trip')." -ForegroundColor Yellow
  exit 1
}

Write-Host "`n[2/2] Quick check: vendor tx endpoint still OK..." -ForegroundColor Cyan
try {
  $tx = Invoke-RestMethod -Method GET -Uri "$base/api/admin/wallet/transactions?kind=vendor&id=11111111-1111-1111-1111-111111111111&limit=5"
  Write-Host "[OK] vendor wallet tx:" -ForegroundColor Green
  $tx | ConvertTo-Json -Depth 10
} catch {
  Write-Host "[HTTP ERROR] vendor tx fetch failed:" -ForegroundColor Yellow
  Write-Host (Read-RawHttpError $_)
  exit 1
}
