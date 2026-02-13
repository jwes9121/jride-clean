<# 
PATCH-JRIDE_BOOK_FREE_RIDE_AUDIT_REMOVE_CREATED_BY_USER_V1_PS5SAFE.ps1

Fix:
- Remove "created_by_user_id: user.id," (and similar user?.id) from passenger_free_ride_audit inserts
  because `user` is not in scope there -> TS compile error.

PS5-safe. Creates backup.
#>

param(
  [string]$RepoRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red }

$target = Join-Path $RepoRoot "app\api\public\passenger\book\route.ts"
if (-not (Test-Path $target)) {
  Fail ("[FAIL] Target not found: {0}" -f $target)
  exit 1
}

# Backup
$bakDir = Join-Path $RepoRoot "_patch_bak"
if (-not (Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bakFile = Join-Path $bakDir ("book.route.ts.bak.FREE_RIDE_AUDIT_V1." + $timestamp)
Copy-Item $target $bakFile -Force
Ok ("[OK] Backup: {0}" -f $bakFile)

$content = Get-Content -LiteralPath $target -Raw
$orig = $content

# Remove lines like:
# created_by_user_id: user.id,
# created_by_user_id: user?.id,
# created_by_user_id: user!.id,
# with any indentation
$pattern = "(?m)^[ \t]*created_by_user_id\s*:\s*user[^\r\n]*,\s*\r?\n"
$content = [regex]::Replace($content, $pattern, "")

if ($content -eq $orig) {
  Warn "[WARN] No created_by_user_id: user.* line found to remove (maybe already fixed or different name)."
} else {
  Ok "[OK] Removed created_by_user_id: user.* line(s)."
}

Set-Content -LiteralPath $target -Value $content -Encoding UTF8
Ok "[OK] Patch applied."
Ok ("[OK] Target: {0}" -f $target)
