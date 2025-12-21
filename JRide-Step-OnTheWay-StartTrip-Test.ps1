$ErrorActionPreference = "Stop"

function Fail($m) { Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }
function Ok($m) { Write-Host "[OK]   $m" -ForegroundColor Green }

$root = Get-Location
$envFile = Join-Path $root ".env.local"
if (!(Test-Path $envFile)) { Fail ".env.local not found at: $envFile" }

# load .env.local
$envMap = @{}
Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if ($line -eq "" -or $line.StartsWith("#")) { return }
  $idx = $line.IndexOf("=")
  if ($idx -lt 1) { return }
  $k = $line.Substring(0, $idx).Trim()
  $v = $line.Substring($idx+1).Trim().Trim('"')
  $envMap[$k] = $v
}

$SUPABASE_URL = $envMap["SUPABASE_URL"]
if ([string]::IsNullOrWhiteSpace($SUPABASE_URL)) { $SUPABASE_URL = $envMap["NEXT_PUBLIC_SUPABASE_URL"] }

$SUPABASE_KEY = $envMap["SUPABASE_SERVICE_ROLE_KEY"]
if ([string]::IsNullOrWhiteSpace($SUPABASE_KEY)) { $SUPABASE_KEY = $envMap["SUPABASE_SERVICE_ROLE"] }
if ([string]::IsNullOrWhiteSpace($SUPABASE_KEY)) { $SUPABASE_KEY = $envMap["SUPABASE_ANON_KEY"] }
if ([string]::IsNullOrWhiteSpace($SUPABASE_KEY)) { $SUPABASE_KEY = $envMap["NEXT_PUBLIC_SUPABASE_ANON_KEY"] }

if ([string]::IsNullOrWhiteSpace($SUPABASE_URL)) { Fail "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL" }
if ([string]::IsNullOrWhiteSpace($SUPABASE_KEY)) { Fail "Missing Supabase key" }

$headers = @{
  "apikey"        = $SUPABASE_KEY
  "Authorization" = "Bearer $SUPABASE_KEY"
  "Content-Type"  = "application/json"
}

$bookingCode = "TEST-ERRAND-1"

function Call-Rpc($name, $payload) {
  $url = "$SUPABASE_URL/rest/v1/rpc/$name"
  $body = ($payload | ConvertTo-Json)
  try {
    return Invoke-RestMethod -Method POST -Uri $url -Headers $headers -Body $body
  } catch {
    $msg = $_.Exception.Message
    Write-Host "[RPC FAIL] $name -> $msg" -ForegroundColor Yellow
    throw
  }
}

function Get-BookingStatus($code) {
  $url = "$SUPABASE_URL/rest/v1/bookings?select=booking_code,status,updated_at&booking_code=eq.$code&order=updated_at.desc&limit=1"
  $r = Invoke-RestMethod -Method GET -Uri $url -Headers $headers
  if ($r.Count -lt 1) { return $null }
  return $r[0]
}

Write-Host "== BEFORE ==" -ForegroundColor Cyan
$b0 = Get-BookingStatus $bookingCode
if ($null -eq $b0) { Fail "Booking not found by booking_code=$bookingCode" }
$b0 | Format-Table booking_code,status,updated_at -AutoSize

Write-Host "`n== ON_THE_WAY ==" -ForegroundColor Cyan
$r1 = Call-Rpc "admin_set_trip_on_the_way" @{ p_booking_code = $bookingCode }
Ok ("Response: " + ($r1 | ConvertTo-Json -Compress))

Start-Sleep -Milliseconds 400
$b1 = Get-BookingStatus $bookingCode
$b1 | Format-Table booking_code,status,updated_at -AutoSize

Write-Host "`n== START_TRIP (ON_TRIP) ==" -ForegroundColor Cyan
$r2 = Call-Rpc "admin_set_trip_on_trip" @{ p_booking_code = $bookingCode }
Ok ("Response: " + ($r2 | ConvertTo-Json -Compress))

Start-Sleep -Milliseconds 400
$b2 = Get-BookingStatus $bookingCode
$b2 | Format-Table booking_code,status,updated_at -AutoSize

Write-Host "`nDONE." -ForegroundColor Green
