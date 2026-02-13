# PATCH-JRIDE_PASSENGER_FARE_ACCEPT_SET_READY_V1_PS5SAFE.ps1
param(
  [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Fail($m){ Write-Host $m -ForegroundColor Red; throw $m }

$target = Join-Path $RepoRoot "app\api\public\passenger\fare\accept\route.ts"
if (-not (Test-Path $target)) { Fail "[FAIL] Missing: $target" }

$bakDir = Join-Path $RepoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("passenger.fare.accept.route.ts.bak.V1." + $stamp)
Copy-Item $target $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

$content = Get-Content -LiteralPath $target -Raw -Encoding UTF8

# Replace the update payload:
# from: { passenger_fare_response: "accepted" }
# to:   { passenger_fare_response: "accepted", status:"ready", driver_status:"ready", customer_status:"ready" }
$old = 'passenger_fare_response:\s*"accepted"\s*'
if (-not ([regex]::IsMatch($content, $old))) {
  Fail "[FAIL] Could not find passenger_fare_response: ""accepted"" in accept route."
}

$content2 = [regex]::Replace(
  $content,
  $old,
  'passenger_fare_response: "accepted",' + "`r`n" +
  '      status: "ready",' + "`r`n" +
  '      driver_status: "ready",' + "`r`n" +
  '      customer_status: "ready"'
)

Set-Content -LiteralPath $target -Value $content2 -Encoding UTF8
Ok ("[OK] Patched: {0}" -f $target)
Ok "[OK] Done."
