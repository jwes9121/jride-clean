# RESTORE-LIVETRIPSCLIENT_FROM_GIT_HEAD_V1.ps1
# Restores app\admin\livetrips\LiveTripsClient.tsx from git HEAD
# while making a timestamped backup first. UTF-8 no BOM preserved by git.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = Get-Location
$targetRel = "app\admin\livetrips\LiveTripsClient.tsx"
$target = Join-Path $root $targetRel
if (!(Test-Path $target)) { Fail "Missing file: $target" }

# Ensure we're in a git repo
git rev-parse --is-inside-work-tree *>$null
if ($LASTEXITCODE -ne 0) { Fail "Not inside a git repo. Run this from repo root." }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak"

# Restore file from HEAD
git checkout -- $targetRel
if ($LASTEXITCODE -ne 0) { Fail "git checkout failed for $targetRel" }

Write-Host "[OK] Restored from git HEAD: $targetRel"
Write-Host "DONE: LiveTripsClient restore completed."
