$ErrorActionPreference="Stop"

$root="C:\Users\jwes9\Desktop\jride-clean-fresh"
$envPath=Join-Path $root ".env.local"
if(!(Test-Path $envPath)){ throw "Missing .env.local at $envPath" }

Get-Content $envPath | ForEach-Object{
  $line=$_.Trim()
  if($line -eq "" -or $line.StartsWith("#")){ return }
  $m=[regex]::Match($line,'^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$')
  if(!$m.Success){ return }
  $k=$m.Groups[1].Value
  $v=$m.Groups[2].Value
  if($v.StartsWith('"') -and $v.EndsWith('"')){ $v=$v.Substring(1,$v.Length-2) }
  if($v.StartsWith("'") -and $v.EndsWith("'")){ $v=$v.Substring(1,$v.Length-2) }
  [Environment]::SetEnvironmentVariable($k,$v,"Process")
}

$sbUrl=$env:NEXT_PUBLIC_SUPABASE_URL.TrimEnd("/")
$anon=$env:NEXT_PUBLIC_SUPABASE_ANON_KEY
if([string]::IsNullOrEmpty($sbUrl) -or [string]::IsNullOrEmpty($anon)){ throw "Missing Supabase URL/Anon key" }

$h=@{ apikey=$anon; Authorization="Bearer $anon"; "Content-Type"="application/json" }

$code = "TEST-ERRAND-1"

# Read booking by code (now allowed by policy)
$getUrl = "$sbUrl/rest/v1/bookings?select=id,booking_code,status,updated_at&booking_code=eq.$code&limit=1"
$b = Invoke-RestMethod -Method Get -Uri $getUrl -Headers $h
if(!$b -or $b.Count -lt 1){ throw "Booking not found for booking_code=$code" }

$bookingId = $b[0].id
Write-Host "Found $code id=$bookingId status=$($b[0].status)" -ForegroundColor Cyan

# Call JSONB RPC (PostgREST-friendly)
$rpcUrl = "$sbUrl/rest/v1/rpc/dispatcher_update_booking_status"
$bodyObj = @{ params = @{ booking_id = $bookingId; status = "on_the_way" } }
$body = ($bodyObj | ConvertTo-Json -Depth 10)

Write-Host "`nPOST $rpcUrl (on_the_way)" -ForegroundColor Yellow
$res = Invoke-RestMethod -Method Post -Uri $rpcUrl -Headers $h -Body $body
Write-Host ($res | ConvertTo-Json -Depth 10)

# Verify
$verifyUrl = "$sbUrl/rest/v1/bookings?select=id,booking_code,status,updated_at&id=eq.$bookingId"
$v = Invoke-RestMethod -Method Get -Uri $verifyUrl -Headers $h
Write-Host "`nVerify:" -ForegroundColor Green
Write-Host ($v | ConvertTo-Json -Depth 10)
