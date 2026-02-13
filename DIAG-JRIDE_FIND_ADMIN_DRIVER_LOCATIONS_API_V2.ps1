# DIAG-JRIDE_FIND_ADMIN_DRIVER_LOCATIONS_API_V2.ps1
# Finds the Admin Driver Locations API route file and any route.ts files mentioning driver_locations
# NOTE: Uses $hits, NOT $matches/$Matches (PowerShell automatic var).

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }

function Find-RepoRoot([string]$start) {
  $cur = Resolve-Path $start
  while ($true) {
    if (Test-Path (Join-Path $cur "package.json")) { return $cur }
    $parent = Split-Path $cur -Parent
    if ($parent -eq $cur) { break }
    $cur = $parent
  }
  return $null
}

$startDir = Get-Location
$root = Find-RepoRoot $startDir.Path
if (-not $root) { Fail "Could not find repo root (package.json). Run this inside your repo." }

Write-Host "=== Repo root ===" -ForegroundColor Cyan
Write-Host $root

Write-Host ""
Write-Host "=== Search: likely route file path app/api/admin/driver_locations/route.ts ===" -ForegroundColor Cyan
$likely = Join-Path $root "app\api\admin\driver_locations\route.ts"
if (Test-Path $likely) {
  Write-Host "[OK] Found: $likely" -ForegroundColor Green
} else {
  Write-Host "[WARN] Not found: $likely" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Search: files named route.ts under app\api\admin that contain 'driver_locations' ===" -ForegroundColor Cyan

$adminApi = Join-Path $root "app\api\admin"
if (-not (Test-Path $adminApi)) {
  Write-Host "[WARN] Not found: $adminApi" -ForegroundColor Yellow
  exit 0
}

$hits = New-Object System.Collections.Generic.List[string]

Get-ChildItem -Path $adminApi -Recurse -File -Filter "route.ts" | ForEach-Object {
  $p = $_.FullName
  try {
    $txt = Get-Content -LiteralPath $p -Raw -Encoding UTF8
  } catch {
    # fallback (some files might not be UTF8)
    $txt = Get-Content -LiteralPath $p -Raw
  }

  if ($txt -match "driver_locations") {
    $hits.Add($p) | Out-Null
  }
}

if ($hits.Count -eq 0) {
  Write-Host "[OK] No route.ts under app\api\admin mentions driver_locations" -ForegroundColor Green
} else {
  Write-Host "[OK] Found $($hits.Count) file(s):" -ForegroundColor Green
  $hits | Sort-Object | ForEach-Object { Write-Host " - $_" }
}
