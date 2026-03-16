param(
  [string]$WebRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

$oldPath = Join-Path $WebRoot "app\api\_diag"
$newPath = Join-Path $WebRoot "app\api\diag"

if (!(Test-Path $oldPath)) {
  Write-Host "Source folder not found: $oldPath"
  exit 1
}

if (Test-Path $newPath) {
  Write-Host "Destination already exists: $newPath"
  exit 1
}

Move-Item $oldPath $newPath

Write-Host "[OK] Renamed folder:" -ForegroundColor Green
Write-Host "$oldPath -> $newPath"