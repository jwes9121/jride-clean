# PATCH-JRIDE_BACKEND_ACTIVE_TRIP_DRIVERID_FALLBACK_V1.ps1
# Fix: active-trip should match assigned_driver_id OR driver_id
# Path: app\api\driver\active-trip\route.ts

$ErrorActionPreference = "Stop"

$ROOT = "C:\Users\jwes9\Desktop\jride-clean-fresh"
Set-Location $ROOT

$target = Join-Path $ROOT "app\api\driver\active-trip\route.ts"
if (!(Test-Path $target)) { throw "Missing file: $target" }

# Backup
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $ROOT "_patch_backups"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir ("app__api__driver__active-trip__route.ts.bak.$stamp")
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$src = Get-Content -LiteralPath $target -Raw

# We expect something like:
# .eq("assigned_driver_id", driverId)
# Replace with:
# .or(`assigned_driver_id.eq.${driverId},driver_id.eq.${driverId}`)
# BUT we must keep it as a JS template string inside TS.
if ($src -notmatch '\.eq\(\s*"assigned_driver_id"\s*,\s*driverId\s*\)') {
  Write-Host "[WARN] Could not find .eq(""assigned_driver_id"", driverId) exact pattern. Trying a broader patch..." -ForegroundColor Yellow

  # broader: find the query block and patch the first occurrence of assigned_driver_id filter
  $src2 = $src -replace '\.eq\(\s*"assigned_driver_id"\s*,\s*([a-zA-Z0-9_]+)\s*\)',
    '.or(`assigned_driver_id.eq.${$1},driver_id.eq.${$1}`)'

  if ($src2 -eq $src) {
    throw "No changes applied. Could not find an assigned_driver_id eq() filter to patch."
  }
  $src = $src2
} else {
  $src = $src -replace '\.eq\(\s*"assigned_driver_id"\s*,\s*driverId\s*\)',
    '.or(`assigned_driver_id.eq.${driverId},driver_id.eq.${driverId}`)'
}

Set-Content -LiteralPath $target -Value $src -Encoding UTF8
Write-Host "[OK] Patched: $target" -ForegroundColor Green

Write-Host "`n[NEXT] Build check:" -ForegroundColor Cyan
Write-Host "  npm.cmd run build" -ForegroundColor Cyan
