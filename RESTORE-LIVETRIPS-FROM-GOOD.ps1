# RESTORE-LIVETRIPS-FROM-GOOD.ps1
# Restores ONLY LiveTrips-related files from commit 8ccce09 (JRIDE_VENDOR_PAYOUT_OK),
# keeping everything else on your current HEAD.

$ErrorActionPreference = "Stop"
Set-Location "C:\Users\jwes9\Desktop\jride-clean-fresh"

$commit = "8ccce09"
$ts = Get-Date -Format "yyyyMMdd-HHmmss"

function Fail($m){ Write-Host "[FAIL] $m" -ForegroundColor Red; throw $m }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

# Sanity checks
git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) { Fail "Not a git repo. Run from repo root." }

# LiveTrips files we want back (advanced UI)
$paths = @(
  "app/admin/livetrips/LiveTripsClient.tsx",
  "app/admin/livetrips/components/LiveTripsMap.tsx",
  "app/admin/livetrips/components/DispatchActionPanel.tsx",
  "app/api/dispatch/status/route.ts",
  "app/api/admin/livetrips/page-data/route.ts",
  "app/api/admin/driver-locations/route.ts"
)

Info "Checking which files exist in commit $commit..."
$existing = @()
foreach ($p in $paths) {
  git cat-file -e "$commit`:$p" 2>$null
  if ($LASTEXITCODE -eq 0) {
    $existing += $p
    Ok "Found in commit: $p"
  } else {
    Warn "Not found in commit (will skip): $p"
  }
}
if ($existing.Count -eq 0) { Fail "None of the target files exist in commit $commit. Abort." }

Info "Backing up current versions to .bak-$ts ..."
foreach ($p in $existing) {
  if (Test-Path $p) {
    $bak = "$p.bak-$ts"
    New-Item -ItemType Directory -Force -Path (Split-Path $bak) | Out-Null
    Copy-Item -Force $p $bak
    Ok "Backup created: $bak"
  } else {
    Warn "File not currently present (no backup): $p"
  }
}

Info "Restoring files from commit $commit ..."
foreach ($p in $existing) {
  # Prefer git restore if available
  git restore --source $commit -- $p 2>$null
  if ($LASTEXITCODE -ne 0) {
    # fallback for older git
    git checkout $commit -- $p
    if ($LASTEXITCODE -ne 0) { Fail "Could not restore $p from $commit" }
  }
  Ok "Restored: $p"
}

Info "Clearing Next.js cache (.next) to avoid stale compilation..."
if (Test-Path ".next") { Remove-Item -Recurse -Force ".next" }

Ok "Done. Now restart dev server:"
Write-Host "  1) Stop current npm dev (Ctrl+C)" -ForegroundColor Gray
Write-Host "  2) npm run dev" -ForegroundColor Gray
