param(
  [Parameter(Mandatory = $true)]
  [string]$AndroidRoot
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "RESTORE JRIDE MAINACTIVITY FROM LAST BACKUP" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$target = Join-Path $AndroidRoot "app\src\main\java\com\jride\app\MainActivity.kt"
if (-not (Test-Path -LiteralPath $target)) {
  throw "Target file not found: $target"
}

$backupRoot = Join-Path $AndroidRoot "_patch_bak"
if (-not (Test-Path -LiteralPath $backupRoot)) {
  throw "Backup root not found: $backupRoot"
}

$latestPatchDir = Get-ChildItem -LiteralPath $backupRoot -Directory |
  Where-Object { $_.Name -like "BLOCK_STALE_ASSIGNED_POPUP_V1_*" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $latestPatchDir) {
  throw "No BLOCK_STALE_ASSIGNED_POPUP_V1 backup folder found under: $backupRoot"
}

$backupFile = Join-Path $latestPatchDir.FullName "MainActivity.kt.bak"
if (-not (Test-Path -LiteralPath $backupFile)) {
  throw "Backup file not found: $backupFile"
}

$restoreStamp = Get-Date -Format "yyyyMMdd_HHmmss"
$safetyDir = Join-Path $backupRoot ("RESTORE_MAINACTIVITY_BEFORE_RECOVERY_" + $restoreStamp)
New-Item -ItemType Directory -Force -Path $safetyDir | Out-Null
$safetyFile = Join-Path $safetyDir "MainActivity.kt.pre_restore.bak"

Copy-Item -LiteralPath $target -Destination $safetyFile -Force
Copy-Item -LiteralPath $backupFile -Destination $target -Force

Write-Host "[OK] Restored MainActivity.kt from:" -ForegroundColor Green
Write-Host "     $backupFile" -ForegroundColor White
Write-Host "[OK] Safety backup of broken file saved to:" -ForegroundColor Green
Write-Host "     $safetyFile" -ForegroundColor White
Write-Host ""
Write-Host "[DONE] Restore completed." -ForegroundColor Green
Write-Host ""