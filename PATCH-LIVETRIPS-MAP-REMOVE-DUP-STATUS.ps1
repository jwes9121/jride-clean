# PATCH-LIVETRIPS-MAP-REMOVE-DUP-STATUS.ps1
# Removes the duplicate "const status = ..." inserted by the previous patch.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$t = Get-Content -LiteralPath $f -Raw -Encoding UTF8

# Remove ONLY the duplicate status line that appears after the "Pending/assigned" comment block.
# We keep the comments and the target assignment; we only delete the extra const status line.
$rxDup = '(?s)(\/\/\s*Pending\/assigned:\s*follow\s*pickup.*?\r?\n)\s*const\s+status\s*=\s*String\(raw\.status\s*\?\?\s*""\)\.toLowerCase\(\)\.trim\(\);\s*\r?\n'

if ($t -notmatch $rxDup) {
  Fail "Did not find the duplicate status line after the Pending/assigned comment block."
}

$t2 = [regex]::Replace($t, $rxDup, '$1', 1)

Set-Content -LiteralPath $f -Value $t2 -Encoding UTF8
Write-Host "PATCHED: removed duplicate const status in $f" -ForegroundColor Green
