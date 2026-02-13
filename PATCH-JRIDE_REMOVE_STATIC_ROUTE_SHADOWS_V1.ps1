# PATCH-JRIDE_REMOVE_STATIC_ROUTE_SHADOWS_V1.ps1
# Removes App Router files that shadow /public static assets
# PS5-safe

$ErrorActionPreference = "Stop"

$root = Get-Location
$bak = Join-Path $root "_patch_bak\static_route_shadow"
New-Item -ItemType Directory -Force -Path $bak | Out-Null

Write-Host "== JRide: Removing static route shadows ==" -ForegroundColor Cyan

$patterns = @("robots", "favicon", "vendor-samples")

$targets = Get-ChildItem -Path .\app -Recurse | Where-Object {
  $patterns | Where-Object { $_ -and $_ -ne "" -and $_ -ne $null } | ForEach-Object {
    $_
  }
  ($_.FullName -match "robots" -or
   $_.FullName -match "favicon" -or
   $_.FullName -match "vendor-samples")
}

if (-not $targets) {
  Write-Host "[OK] No shadowing routes found." -ForegroundColor Green
  return
}

foreach ($t in $targets) {
  $dest = Join-Path $bak ($t.FullName -replace "[\\/:]", "_")
  Copy-Item $t.FullName $dest -Force -Recurse
  Remove-Item $t.FullName -Force -Recurse
  Write-Host ("[REMOVED] {0}" -f $t.FullName) -ForegroundColor Yellow
}

Write-Host "[OK] Shadow routes removed. Rebuild required." -ForegroundColor Green
