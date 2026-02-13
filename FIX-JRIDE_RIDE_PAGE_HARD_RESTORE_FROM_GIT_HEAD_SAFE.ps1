# FIX-JRIDE_RIDE_PAGE_HARD_RESTORE_FROM_GIT_HEAD_SAFE.ps1
# Restores app\ride\page.tsx to the last committed (HEAD) version.
# Purpose: recover from broken JSX fragments / parser failures.
# UI-only recovery (no backend/map changes), deterministic.
#
# NOTE: This ONLY restores app\ride\page.tsx. Other files remain unchanged.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

function Backup($p){
  $ts=(Get-Date).ToString("yyyyMMdd_HHmmss")
  $bak="$p.pre_hard_restore.$ts"
  Copy-Item -Force $p $bak
  Write-Host "[OK] Backup: $bak"
}

function Has-GitRepo(){
  try {
    $inside = & git rev-parse --is-inside-work-tree 2>$null
    return ($LASTEXITCODE -eq 0 -and $inside.Trim() -eq "true")
  } catch { return $false }
}

$root = (Get-Location).Path
$targetRel = "app\ride\page.tsx"
$target = Join-Path $root $targetRel

if(!(Test-Path $target)){ Fail "Not found: $targetRel" }
if(!(Has-GitRepo)){ Fail "No git repo detected. Run this from your repo root (where .git exists)." }

Backup $target

# Restore file from HEAD (last commit)
& git checkout HEAD -- $targetRel 2>$null
if($LASTEXITCODE -ne 0){
  Fail "git checkout failed while restoring $targetRel from HEAD."
}

Write-Host "[OK] Restored $targetRel from HEAD."
Write-Host ""
Write-Host "[NEXT] Run build:"
Write-Host "  npm.cmd run build"
