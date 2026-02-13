# COMMIT-AND-TAG-NEXT_WALLETS_PHASE.ps1
$ErrorActionPreference="Stop"
function Fail($m){ throw $m }

git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) { Fail "Not inside a git repo. Run from repo root." }

Write-Host "[1/6] Status (pre)..." -ForegroundColor Cyan
git status

Write-Host "`n[2/6] Add all..." -ForegroundColor Cyan
git add -A

Write-Host "`n[3/6] Commit..." -ForegroundColor Cyan
git commit -m "NEXT_WALLETS_PHASE: min wallet precheck (250) + audit logging" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "[INFO] No changes to commit (or commit failed). Continuing to tagging step..." -ForegroundColor Yellow
}

# Choose next incremental tag automatically (v1.5 if free else v1.6+)
$baseTag = "livetrips-dispatch-v1."
$existing = git tag --list "livetrips-dispatch-v1.*"
$nums = @()
foreach ($t in $existing) {
  if ($t -match '^livetrips-dispatch-v1\.(\d+)$') { $nums += [int]$Matches[1] }
}
$next = 5
if ($nums.Count -gt 0) { $next = ([int]($nums | Measure-Object -Maximum).Maximum) + 1 }
$tag = "livetrips-dispatch-v1.$next"

Write-Host "`n[4/6] Create tag: $tag" -ForegroundColor Cyan
git tag $tag
if ($LASTEXITCODE -ne 0) { Fail "Tag create failed. If it already exists, pick another number." }

Write-Host "`n[5/6] Push commit..." -ForegroundColor Cyan
git push
if ($LASTEXITCODE -ne 0) { Fail "git push failed." }

Write-Host "`n[6/6] Push tags..." -ForegroundColor Cyan
git push --tags
if ($LASTEXITCODE -ne 0) { Fail "git push --tags failed." }

Write-Host "`n[OK] Saved rollback point: $tag" -ForegroundColor Green
git show -s --oneline --decorate
