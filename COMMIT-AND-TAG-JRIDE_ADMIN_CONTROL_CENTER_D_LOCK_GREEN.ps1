# COMMIT-AND-TAG-JRIDE_ADMIN_CONTROL_CENTER_D_LOCK_GREEN.ps1
# Final lock: run build, then git add/commit/tag/push. Stops on any failure.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

$repoRoot = (Get-Location).Path

Write-Host "[STEP] npm.cmd run build"
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { Fail "Build failed. Fix build errors before locking." }
Write-Host "[OK] Build GREEN"

# Commit message + tag for final lock
$msg = "chore(admin-control-center): D lock milestone (UI only)"
$tag = "JRIDE_ADMIN_CONTROL_CENTER_D_LOCK_GREEN"

Write-Host "[STEP] git status"
& git status

Write-Host "[STEP] git add -A"
& git add -A
if ($LASTEXITCODE -ne 0) { Fail "git add failed" }

Write-Host "[STEP] git commit -m `"$msg`""
& git commit -m $msg
if ($LASTEXITCODE -ne 0) {
  Write-Host "[WARN] git commit returned non-zero (maybe nothing to commit)."
}

Write-Host "[STEP] git tag $tag"
& git tag $tag
if ($LASTEXITCODE -ne 0) { Fail "git tag failed (tag may already exist)." }

Write-Host "[STEP] git push"
& git push
if ($LASTEXITCODE -ne 0) { Fail "git push failed" }

Write-Host "[STEP] git push --tags"
& git push --tags
if ($LASTEXITCODE -ne 0) { Fail "git push --tags failed" }

Write-Host "[OK] FINAL LOCK COMPLETE: $tag"
