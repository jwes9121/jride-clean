param(
  [string]$RepoRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host $m -ForegroundColor Red; exit 1 }

$target = Join-Path $RepoRoot "app\api\public\auth\signup\route.ts"
$bakDir = Join-Path $RepoRoot "_patch_bak"

if (!(Test-Path $target)) { Die "Missing target: $target" }
if (!(Test-Path $bakDir)) { Die "Missing backup dir: $bakDir" }

# Find newest backup for this file
$bak = Get-ChildItem -Path $bakDir -File |
  Where-Object { $_.Name -like "app_api_public_auth_signup_route.ts.bak.*" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (!$bak) { Die "No backup found matching app_api_public_auth_signup_route.ts.bak.*" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$pre = Join-Path $bakDir ("CURRENT_app_api_public_auth_signup_route.ts.bak." + $stamp)
Copy-Item -LiteralPath $target -Destination $pre -Force
Ok ("[OK] Saved current broken file to: {0}" -f $pre)

Copy-Item -LiteralPath $bak.FullName -Destination $target -Force
Ok ("[OK] Restored from backup: {0}" -f $bak.FullName)

Ok "[OK] DONE. Now run: npm.cmd run build"
