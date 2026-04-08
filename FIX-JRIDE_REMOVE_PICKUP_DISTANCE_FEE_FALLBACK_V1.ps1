param(
  [Parameter(Mandatory=$true)]
  [string]$WebRoot
)

$ErrorActionPreference = "Stop"

function Backup-File {
  param([string]$Path)

  $dir = Split-Path -Parent $Path
  $bakDir = Join-Path $dir "_patch_bak"
  if (!(Test-Path $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir | Out-Null
  }

  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = Split-Path $Path -Leaf
  $bak = Join-Path $bakDir ($name + ".REMOVE_PICKUP_DISTANCE_FEE_FALLBACK_V1." + $stamp + ".bak")
  Copy-Item $Path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Replace-ExactText {
  param(
    [string]$Path,
    [string]$Old,
    [string]$New
  )

  if (!(Test-Path $Path)) {
    throw "File not found: $Path"
  }

  $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  if ($raw -notlike "*$Old*") {
    throw "Expected text not found in: $Path`n--- EXPECTED ---`n$Old"
  }

  $updated = $raw.Replace($Old, $New)
  if ($updated -eq $raw) {
    throw "No change made to: $Path"
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $updated, $utf8NoBom)
  Write-Host "[OK] Patched: $Path"
}

$driverPath = Join-Path $WebRoot "app\api\driver\active-trip\route.ts"
$trackPath  = Join-Path $WebRoot "app\api\public\passenger\track\route.ts"

if (!(Test-Path $driverPath)) {
  throw "Driver route not found: $driverPath"
}
if (!(Test-Path $trackPath)) {
  throw "Passenger track route not found: $trackPath"
}

Backup-File $driverPath
Backup-File $trackPath

$oldBlock = @"
    distance_km:
      num(row.driver_to_pickup_km) ??
      num(row.pickup_distance_km) ??
      num(row.pickup_distance_fee) ??
      null,
"@

$newBlock = @"
    distance_km:
      num(row.driver_to_pickup_km) ??
      num(row.pickup_distance_km) ??
      null,
"@

Replace-ExactText -Path $driverPath -Old $oldBlock -New $newBlock
Replace-ExactText -Path $trackPath  -Old $oldBlock -New $newBlock

Write-Host ""
Write-Host "=== VERIFY ==="
Select-String -Path $driverPath, $trackPath -Pattern "pickup_distance_fee|driver_to_pickup_km|trip_distance_km"

Write-Host ""
Write-Host "[DONE] Removed pickup_distance_fee from route distance fallback in both routes."