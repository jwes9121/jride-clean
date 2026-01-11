# FIX-JRIDE_PHASE3H_LIVETRIPS_RESTORE_LAST_GOOD.ps1
$ErrorActionPreference = "Stop"

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"

$bak = Get-ChildItem "$target.bak.*" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (!$bak) {
  throw "No backup found for LiveTripsClient.tsx"
}

Copy-Item $bak.FullName $target -Force
Write-Host "[OK] Restored from backup: $($bak.Name)" -ForegroundColor Green
