$ErrorActionPreference = "Stop"

function Fail($m) { Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }
function Ok($m) { Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }

function CoalesceStr($a, $b) {
  if (![string]::IsNullOrWhiteSpace($a)) { return $a }
  return $b
}

$repo = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$envFile = Join-Path $repo ".env.local"
if (!(Test-Path $envFile)) { Fail ".env.local not found at: $envFile" }

# Load .env.local
$envMap = @{}
Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if ($line -eq "" -or $line.StartsWith("#")) { return }
  $idx = $line.IndexOf("=")
  if ($idx -lt 1) { return }
  $k = $line.Substring(0, $idx).Trim()
  $v = $line.Substring($idx + 1).Trim()
  if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Trim('"') }
  $envMap[$k] = $v
}

$SUPABASE_URL = CoalesceStr $envMap["SUPABASE_URL"] $envMap["NEXT_PUBLIC_SUPABASE_URL"]

$SUPABASE_KEY = $envMap["SUPABASE_SERVICE_ROLE_KEY"]
if ([string]::IsNullOrWhiteSpace($SUPABASE_KEY)) { $SUPABASE_KEY = $envMap["SUPABASE_SERVICE_ROLE"] }
if ([string]::IsNullOrWhiteSpace($SUPABASE_KEY)) { $SUPABASE_KEY = $envMap["SUPABASE_ANON_KEY"] }
if ([string]::IsNullOrWhiteSpace($SUPABASE_KEY)) { $SUPABASE_KEY = $envMap["NEXT_PUBLIC_SUPABASE_ANON_KEY"] }

if ([string]::IsNullOrWhiteSpace($SUPABASE_URL)) { Fail "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL in .env.local" }
if ([string]::IsNullOrWhiteSpace($SUPABASE_KEY)) { Fail "Missing Supabase key. Prefer SUPABASE_SERVICE_ROLE_KEY in .env.local" }

$headers = @{
  "apikey"        = $SUPABASE_KEY
  "Authorization" = "Bearer $SUPABASE_KEY"
  "Content-Type"  = "application/json"
}

Info "Querying bookings columns via REST..."
$cols = $null
try {
  $url = "$SUPABASE_URL/rest/v1/information_schema.columns?select=column_name,data_type&table_schema=eq.public&table_name=eq.bookings&order=column_name.asc"
  $cols = Invoke-RestMethod -Method GET -Uri $url -Headers $headers
} catch {
  Fail "Could not read information_schema.columns via PostgREST. Run in Supabase SQL instead:
select column_name,data_type from information_schema.columns where table_schema='public' and table_name='bookings' order by column_name;"
}

if ($null -eq $cols -or $cols.Count -lt 1) { Fail "No columns returned for public.bookings" }

$colNames = @($cols | ForEach-Object { $_.column_name })
Ok ("Found " + $colNames.Count + " columns on public.bookings")

# Candidate earnings columns (order matters)
$fareCandidates     = @("fare","total_fare","amount","total_amount","passenger_fare","passenger_fare_amount","passenger_amount","gross_fare")
$platformCandidates = @("platform_fee","service_fee","total_service_fee","platform_cut","app_fee")
$driverCandidates   = @("driver_cut","driver_earnings","driver_fee","driver_amount","driver_share")
$vendorCandidates   = @("vendor_cut","vendor_earnings","vendor_fee","vendor_amount","vendor_share")

function Pick-Col($cands, $names) {
  foreach ($c in $cands) {
    if ($names -contains $c) { return $c }
  }
  return $null
}

$fareCol     = Pick-Col $fareCandidates     $colNames
$platformCol = Pick-Col $platformCandidates $colNames
$driverCol   = Pick-Col $driverCandidates   $colNames
$vendorCol   = Pick-Col $vendorCandidates   $colNames

Info "Detected earnings columns:"
Write-Host ("  fare:     " + (CoalesceStr $fareCol "<none>")) -ForegroundColor Gray
Write-Host ("  platform: " + (CoalesceStr $platformCol "<none>")) -ForegroundColor Gray
Write-Host ("  driver:   " + (CoalesceStr $driverCol "<none>")) -ForegroundColor Gray
Write-Host ("  vendor:   " + (CoalesceStr $vendorCol "<none>")) -ForegroundColor Gray

function CoalesceNumExpr($col) {
  if ([string]::IsNullOrWhiteSpace($col)) { return "0::numeric" }
  return "coalesce(b.$col, 0)::numeric"
}

$driverExpr   = CoalesceNumExpr $driverCol
$platformExpr = CoalesceNumExpr $platformCol
$vendorExpr   = CoalesceNumExpr $vendorCol

$totalExpr = "0::numeric"
if ($fareCol) {
  $totalExpr = CoalesceNumExpr $fareCol
} elseif ($platformCol -or $driverCol -or $vendorCol) {
  $totalExpr = "($platformExpr + $driverExpr + $vendorExpr)"
}

$viewSql = @"
create or replace view public.admin_trip_earnings_v1 as
select
  b.id as booking_id,
  b.booking_code,
  b.status,
  b.town,
  b.driver_id,
  b.vendor_id,
  $totalExpr as fare_total,
  $platformExpr as platform_earnings,
  $driverExpr as driver_earnings,
  $vendorExpr as vendor_earnings,
  b.created_at,
  b.updated_at
from public.bookings b
where b.status = 'completed'
order by b.updated_at desc;
"@

Info "`n=== COPY THIS SQL INTO SUPABASE SQL EDITOR ==="
Write-Host $viewSql -ForegroundColor Yellow

Ok "Done."
