param(
  [Parameter(Mandatory = $true)]
  [string]$WebRoot
)

$ErrorActionPreference = "Stop"

$Target = Join-Path $WebRoot "app\api\driver\fare\propose\route.ts"

if (!(Test-Path $Target)) {
  throw "File not found: $Target"
}

$BackupDir = Join-Path $WebRoot "app\api\driver\fare\propose\_patch_bak"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $Target "$BackupDir\route.ts.bak.PICKUP_STORE_$Stamp" -Force

Write-Host "[OK] Backup created"

$content = Get-Content $Target -Raw

# =========================================
# INSERT BEFORE updatePayload
# =========================================

$content = $content -replace `
'const updatePayload: Record<string, any> = \{',
@'
const driver_to_pickup_km = 0; // TODO: replace with real distance
const pickup_distance_fee = 0; // TODO: replace with computed fee

const updatePayload: Record<string, any> = {
  driver_to_pickup_km,
  pickup_distance_fee,
'@

Set-Content -Path $Target -Value $content -Encoding utf8

Write-Host "[DONE] Backend now stores pickup fields"