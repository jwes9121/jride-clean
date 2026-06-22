
Write-Host "JRIDE ADMIN ANALYTICS PERIOD FIX V7 - APPLY"

$RepoRoot = (Get-Location).Path
$Target = Join-Path $RepoRoot "app\api\admin\analytics\trips\route.ts"

if (!(Test-Path $Target)) {
  throw "Target route.ts not found"
}

$BackupDir = Join-Path $RepoRoot ("_backup_admin_analytics_period_fix_v7_" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

Copy-Item $Target (Join-Path $BackupDir "route.ts")

$Source = Join-Path $PSScriptRoot "..\files\app\api\admin\analytics\trips\route.ts"
Copy-Item $Source $Target -Force

Write-Host "Updated: app\api\admin\analytics\trips\route.ts"
Write-Host "Apply complete. Run verify next."
