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
  $bak = Join-Path $bakDir ($name + ".REMOVE_PICKUP_DISTANCE_FEE_FALLBACK_V2." + $stamp + ".bak")
  Copy-Item $Path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Write-Utf8NoBom {
  param(
    [string]$Path,
    [string]$Content
  )
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Patch-RouteDistanceFallback {
  param([string]$Path)

  if (!(Test-Path $Path)) {
    throw "File not found: $Path"
  }

  $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8

  if ($raw -notmatch [regex]::Escape('num(row.pickup_distance_fee) ??')) {
    Write-Host "[INFO] No pickup_distance_fee fallback found in: $Path"
    return
  }

  $pattern = @'
distance_km:\s*
\s*num\(row\.driver_to_pickup_km\)\s*\?\?\s*
\s*num\(row\.pickup_distance_km\)\s*\?\?\s*
\s*num\(row\.pickup_distance_fee\)\s*\?\?\s*
\s*null,
'@

  $replacement = @'
distance_km:
      num(row.driver_to_pickup_km) ??
      num(row.pickup_distance_km) ??
      null,
'@

  $updated = [regex]::Replace($raw, $pattern, $replacement)

  if ($updated -eq $raw) {
    throw "Pattern match failed for distance_km block in: $Path"
  }

  Write-Utf8NoBom -Path $Path -Content $updated
  Write-Host "[OK] Patched: $Path"
}

$driverPath = Join-Path $WebRoot "app\api\driver\active-trip\route.ts"

$trackCandidates = @(
  (Join-Path $WebRoot "app\api\passenger\track\route.ts"),
  (Join-Path $WebRoot "app\api\public\passenger\track\route.ts")
)

$trackPath = $trackCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (!(Test-Path $driverPath)) {
  throw "Driver route not found: $driverPath"
}

if ([string]::IsNullOrWhiteSpace($trackPath)) {
  throw "Passenger track route not found in either expected location:`n - $($trackCandidates[0])`n - $($trackCandidates[1])"
}

Write-Host "[INFO] Driver route: $driverPath"
Write-Host "[INFO] Passenger track route: $trackPath"

Backup-File $driverPath
Backup-File $trackPath

Patch-RouteDistanceFallback -Path $driverPath
Patch-RouteDistanceFallback -Path $trackPath

Write-Host ""
Write-Host "=== VERIFY ==="
Select-String -Path $driverPath, $trackPath -Pattern "pickup_distance_fee|driver_to_pickup_km|trip_distance_km"

Write-Host ""
Write-Host "[DONE] Removed pickup_distance_fee from route distance fallback."