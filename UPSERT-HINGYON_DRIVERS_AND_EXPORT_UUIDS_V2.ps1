# UPSERT-HINGYON_DRIVERS_AND_EXPORT_UUIDS_V2.ps1
# Fix: driver_profiles.driver_id likely has NO default, so we generate UUIDs and send them.

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function Fail($m){ throw $m }

$SUPABASE_URL = $env:SUPABASE_URL
$KEY         = $env:SUPABASE_KEY

if ([string]::IsNullOrWhiteSpace($SUPABASE_URL)) { Fail "Missing SUPABASE_URL. Set `$env:SUPABASE_URL first." }
if ([string]::IsNullOrWhiteSpace($KEY))         { Fail "Missing SUPABASE_KEY. Set `$env:SUPABASE_KEY first (Service Role recommended)." }

function Hdr() {
  return @{
    "apikey"        = $KEY
    "Authorization" = "Bearer $KEY"
    "Content-Type"  = "application/json"
    "Accept"        = "application/json"
    "Prefer"        = "return=representation,resolution=merge-duplicates"
  }
}

# FINAL corrected names + known info (fill what you have; null is OK)
$drivers = @(
  @{ full_name="Johnny B. Tabunan Jr.";   municipality="Hingyon"; vehicle_type="trike"; plate_number=$null;         phone="09475291769"; callsign="JR-HIN-039" },
  @{ full_name="James Binwag Puddunan";   municipality="Hingyon"; vehicle_type="trike"; plate_number=$null;         phone="09475229787"; callsign="JR-HIN-020A" },
  @{ full_name="Marcial P. Belingon";     municipality="Hingyon"; vehicle_type="trike"; plate_number="173 YHM";      phone="09658552461"; callsign="JR-HIN-026" },
  @{ full_name="Davis Tan Buyuccan";      municipality="Hingyon"; vehicle_type="trike"; plate_number=$null;         phone="09532339683"; callsign="JR-HIN-001" },
  @{ full_name="Macuswilis B. Pugong";    municipality="Hingyon"; vehicle_type="trike"; plate_number="KB5091870T1"; phone="09603601222"; callsign="JR-HIN-012" },
  @{ full_name="Manuel P. Naboye Jr.";    municipality="Hingyon"; vehicle_type="trike"; plate_number="QN 365";      phone="09330691140"; callsign="JR-HIN-018" },
  @{ full_name="Lloyd Mark Pablo";        municipality="Hingyon"; vehicle_type="trike"; plate_number="#20";         phone="09498469842"; callsign="JR-HIN-020B" }
)

function Show-WebError($err) {
  try {
    $resp = $err.Exception.Response
    if ($resp -and $resp.GetResponseStream()) {
      $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $body = $sr.ReadToEnd()
      if ($body) { Write-Host "   Server says: $body" -ForegroundColor Red }
    }
  } catch {}
}

function Get-ProfileByFullName($name) {
  $enc = [Uri]::EscapeDataString($name)
  $uri = "$SUPABASE_URL/rest/v1/driver_profiles?select=driver_id,full_name,callsign,municipality,vehicle_type,plate_number,phone&full_name=eq.$enc&limit=1"
  $r = Invoke-RestMethod -Method Get -Uri $uri -Headers (Hdr)
  if ($r -and $r.Count -gt 0) { return $r[0] }
  return $null
}

function Upsert-DriverProfile($row) {
  # We upsert by driver_id (primary key) - so we MUST send driver_id.
  $uri = "$SUPABASE_URL/rest/v1/driver_profiles?on_conflict=driver_id"
  $bodyObj = @(
    @{
      driver_id    = $row.driver_id
      full_name    = $row.full_name
      callsign     = $row.callsign
      municipality = $row.municipality
      vehicle_type = $row.vehicle_type
      plate_number = $row.plate_number
      phone        = $row.phone
    }
  )
  $json = $bodyObj | ConvertTo-Json -Depth 10
  return Invoke-RestMethod -Method Post -Uri $uri -Headers (Hdr) -Body $json
}

function Upsert-DriversRow($driverId, $driverName) {
  # Assumes public.drivers primary key is 'id' (matches screenshot)
  $uri = "$SUPABASE_URL/rest/v1/drivers?on_conflict=id"
  $bodyObj = @(
    @{
      id                  = $driverId
      driver_status       = "offline"
      driver_name         = $driverName
      wallet_balance      = 0
      min_wallet_required = 250
      wallet_locked       = $false
    }
  )
  $json = $bodyObj | ConvertTo-Json -Depth 10
  return Invoke-RestMethod -Method Post -Uri $uri -Headers (Hdr) -Body $json
}

Write-Host "== UPSERT Hingyon drivers into driver_profiles and drivers (V2) ==" -ForegroundColor Cyan
Write-Host "Supabase: $SUPABASE_URL" -ForegroundColor DarkGray
Write-Host ""

$final = @()

foreach ($d in $drivers) {
  Write-Host "-> $($d.full_name)" -ForegroundColor Yellow

  $existing = $null
  try { $existing = Get-ProfileByFullName $d.full_name } catch { Show-WebError $_; throw }

  if ($existing) {
    Write-Host "   [EXISTS] driver_id=$($existing.driver_id)" -ForegroundColor DarkYellow
    try { Upsert-DriversRow -driverId $existing.driver_id -driverName $d.full_name | Out-Null } catch { Show-WebError $_; throw }
    $final += $existing
    Write-Host ""
    continue
  }

  # Generate driver_id explicitly (fix for 400)
  $d.driver_id = ([guid]::NewGuid()).ToString()

  try {
    $ins = Upsert-DriverProfile $d
    $newRow = $ins[0]
    Write-Host "   [CREATED] driver_id=$($newRow.driver_id)" -ForegroundColor Green
  } catch {
    Write-Host "   [FAIL] driver_profiles insert" -ForegroundColor Red
    Show-WebError $_
    throw
  }

  try { Upsert-DriversRow -driverId $d.driver_id -driverName $d.full_name | Out-Null } catch {
    Write-Host "   [FAIL] drivers upsert (id=$($d.driver_id))" -ForegroundColor Red
    Show-WebError $_
    throw
  }

  $final += $newRow
  Write-Host ""
}

$out = Join-Path (Get-Location) "HINGYON_DRIVER_UUIDS_READY_FOR_APK.csv"
$final |
  Sort-Object full_name |
  Select-Object full_name,callsign,municipality,phone,plate_number,vehicle_type,
    @{n="driver_uuid";e={$_.driver_id}} |
  Export-Csv -NoTypeInformation -Encoding UTF8 $out

Write-Host "== DONE ==" -ForegroundColor Cyan
Write-Host "Saved: $out" -ForegroundColor Green
Write-Host "Paste driver_uuid into the APK Driver UUID field." -ForegroundColor Cyan
