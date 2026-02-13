# RESTORE-LIVETRIPS-WORKING.ps1
# Restores LiveTrips UI + dispatch action panel + status sync routes from commit e22abbe
# and creates a timestamped backup of current files first.

$ErrorActionPreference = "Stop"

function Stamp() { Get-Date -Format "yyyyMMdd-HHmmss" }
function EnsureDir($p) { if (-not (Test-Path $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null } }

$repo = (Get-Location).Path
$ts = Stamp
$backupRoot = Join-Path $repo "backups\LIVETRIPS_RESTORE_$ts"
EnsureDir $backupRoot

# Target paths to protect + restore
$paths = @(
  "app\admin\livetrips",
  "app\api\dispatch\status\route.ts",
  "app\api\dispatch\assign\route.ts"
)

Write-Host "Backing up current files to: $backupRoot" -ForegroundColor Yellow
foreach ($p in $paths) {
  $full = Join-Path $repo $p
  if (Test-Path $full) {
    $dest = Join-Path $backupRoot $p
    EnsureDir (Split-Path $dest -Parent)
    if ((Get-Item $full).PSIsContainer) {
      Copy-Item -Recurse -Force $full $dest
    } else {
      Copy-Item -Force $full $dest
    }
  } else {
    Write-Host "WARN: path not found (skipping backup): $p" -ForegroundColor DarkYellow
  }
}

# Verify commit exists
$commit = "e22abbe"
git cat-file -e "$commit^{commit}" 2>$null
if ($LASTEXITCODE -ne 0) { throw "Commit $commit not found in this repo. Run: git fetch --all --tags, then rerun." }

Write-Host "Restoring LiveTrips module + dispatch routes from commit $commit ..." -ForegroundColor Cyan

# Restore the whole LiveTrips module folder
git checkout $commit -- "app/admin/livetrips"
if ($LASTEXITCODE -ne 0) { throw "Failed to restore app/admin/livetrips from $commit" }

# Restore dispatch routes if they exist in that commit (safe-guarded)
function TryCheckout($rel) {
  git show "$commit`:$rel" *> $null
  if ($LASTEXITCODE -eq 0) {
    git checkout $commit -- $rel
    if ($LASTEXITCODE -ne 0) { throw "Failed to restore $rel from $commit" }
    Write-Host "Restored: $rel" -ForegroundColor Green
  } else {
    Write-Host "SKIP (not in commit): $rel" -ForegroundColor DarkYellow
  }
}

TryCheckout "app/api/dispatch/status/route.ts"
TryCheckout "app/api/dispatch/assign/route.ts"

Write-Host ""
Write-Host "DONE. Backup saved at:" -ForegroundColor Green
Write-Host $backupRoot -ForegroundColor Green
Write-Host ""
Write-Host "Next:" -ForegroundColor Yellow
Write-Host "  1) Stop dev server (Ctrl+C)" -ForegroundColor Yellow
Write-Host "  2) Delete .next cache (optional but recommended after big restores):" -ForegroundColor Yellow
Write-Host "     Remove-Item -Recurse -Force .next" -ForegroundColor Yellow
Write-Host "  3) Restart: npm run dev" -ForegroundColor Yellow
