# GET-LIVETRIPS-IDS.ps1
$ErrorActionPreference = "Stop"

$base = "https://app.jride.net"
$uri = $base + "/api/admin/livetrips/page-data"

Write-Host "Fetching: $uri"

$r = Invoke-RestMethod -Method GET -Uri $uri -Headers @{ "Cache-Control"="no-cache" }

Write-Host "Sample trips (id, booking_code, driver_id, vendor_id):"

$cands = @()
if ($null -ne $r.trips) { $cands += $r.trips }
if ($null -ne $r.data -and $null -ne $r.data.trips) { $cands += $r.data.trips }
if ($null -ne $r.payload -and $null -ne $r.payload.trips) { $cands += $r.payload.trips }

$cands | Where-Object { $_ } | Select-Object -First 10 | ForEach-Object {
  $id = $_.id
  $code = $_.booking_code
  $did = $_.driver_id
  $vid = $_.vendor_id
  "{0} | {1} | driver_id={2} | vendor_id={3}" -f $id,$code,$did,$vid
}
