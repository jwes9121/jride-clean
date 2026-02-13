# CHECK-JRIDE_ACTIVE_TRIP_ENDPOINT_V1_PS5SAFE.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

$BaseUrl  = "https://app.jride.net"
$DriverId = "d41bf199-96c6-4022-8a3d-09ab9dbd270f"

$u = "$($BaseUrl.TrimEnd('/'))/api/driver/active-trip?driver_id=$DriverId"
Ok "GET $u"

try {
  $r = Invoke-RestMethod -Method Get -Uri $u
  Ok "[OK] Response:"
  ($r | ConvertTo-Json -Depth 12) | Write-Host
} catch {
  Warn "[FAIL] $($_.Exception.Message)"
  throw
}
