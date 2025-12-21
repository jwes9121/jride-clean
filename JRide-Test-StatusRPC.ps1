# Save as: C:\Users\jwes9\Desktop\jride-clean-fresh\JRide-Test-StatusRPC.ps1
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

# Pick latest booking in statuses we care about
$pickUrl = "$sbUrl/rest/v1/bookings?select=id,booking_code,status&status=in.(pending,assigned,on_the_way,on_trip)&order=updated_at.desc&limit=1"
$b = Invoke-RestMethod -Method Get -Uri $pickUrl -Headers $h
if(!$b -or $b.Count -lt 1){ throw "No test booking found in statuses pending/assigned/on_the_way/on_trip" }

$bookingId = $b[0].id
$code = $b[0].booking_code
$old = $b[0].status

Write-Host "Using booking: $code ($bookingId) status=$old" -ForegroundColor Cyan

# Call JSONB RPC (most reliable)
$rpcUrl = "$sbUrl/rest/v1/rpc/dispatcher_update_booking_status"
$bodyObj = @{ params = @{ booking_id = $bookingId; status = "on_the_way" } }
$body = ($bodyObj | ConvertTo-Json -Depth 10)

Write-Host "`nPOST $rpcUrl" -ForegroundColor Yellow
$res = Invoke-RestMethod -Method Post -Uri $rpcUrl -Headers $h -Body $body
$res | ConvertTo-Json -Depth 10

# Verify by re-reading
$verifyUrl = "$sbUrl/rest/v1/bookings?id=eq.$bookingId&select=id,booking_code,status,updated_at"
$v = Invoke-RestMethod -Method Get -Uri $verifyUrl -Headers $h
Write-Host "`nVerify:" -ForegroundColor Green
$v | ConvertTo-Json -Depth 10

