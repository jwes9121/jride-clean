# COMMIT-TAG-WALLET-API.ps1
$ErrorActionPreference="Stop"
function Fail($m){ throw $m }

git add -A
git commit -m "NEXT_WALLETS_PHASE: add admin wallet transactions read-only API" 2>$null | Out-Null
git push

# pick next available livetrips-dispatch-v1.X tag
$existing = git tag --list "livetrips-dispatch-v1.*"
$nums = @()
foreach ($t in $existing) { if ($t -match '^livetrips-dispatch-v1\.(\d+)$') { $nums += [int]$Matches[1] } }
$next = 5
if ($nums.Count -gt 0) { $next = ([int]($nums | Measure-Object -Maximum).Maximum) + 1 }
$tag = "livetrips-dispatch-v1.$next"

git tag $tag
git push --tags

Write-Host "[OK] Tagged: $tag" -ForegroundColor Green
git show -s --oneline --decorate
