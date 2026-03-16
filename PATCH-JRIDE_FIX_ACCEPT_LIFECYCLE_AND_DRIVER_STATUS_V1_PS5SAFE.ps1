param(
  [string]$WebRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

Write-Host "== JRIDE PATCH: FIX ACCEPT LIFECYCLE + DRIVER STATUS TABLE =="

$target = Join-Path $WebRoot "app\api\dispatch\status\route.ts"

if (!(Test-Path $target)) {
  throw "Target file not found: $target"
}

# Backup folder
$backupDir = Join-Path $WebRoot "_patch_bak"
if (!(Test-Path $backupDir)) {
  New-Item -ItemType Directory -Path $backupDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = Join-Path $backupDir "route.ts.bak.DISPATCH_STATUS_FIX_$timestamp"

Copy-Item $target $backupFile -Force
Write-Host "[OK] Backup created: $backupFile"

$content = Get-Content $target -Raw

Write-Host "Scanning for ACCEPT normalization bug..."

# Remove normalization forcing accepted -> assigned
$pattern = 'if\s*\(\s*normalizedStatus\s*===\s*"accepted"\s*\)\s*\{\s*normalizedStatus\s*=\s*"assigned";\s*\}'
if ($content -match $pattern) {
    $content = [regex]::Replace($content, $pattern, "")
    Write-Host "[FIX] Removed accepted→assigned normalization"
} else {
    Write-Host "[INFO] Normalization block not found"
}

Write-Host "Checking driver_locations table update..."

# Replace driver_locations with driver_locations_latest
$pattern2 = 'from\("driver_locations"\)'
if ($content -match $pattern2) {
    $content = [regex]::Replace($content, $pattern2, 'from("driver_locations_latest")')
    Write-Host "[FIX] Updated table to driver_locations_latest"
} else {
    Write-Host "[INFO] driver_locations reference not found or already fixed"
}

Set-Content -Path $target -Value $content -Encoding UTF8

Write-Host "[OK] Patch applied to $target"

Write-Host ""
Write-Host "Patch complete."
Write-Host ""
Write-Host "Next step: run build to confirm compile integrity."