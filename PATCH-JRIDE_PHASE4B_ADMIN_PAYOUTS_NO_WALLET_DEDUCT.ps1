# PATCH-JRIDE_PHASE4B_ADMIN_PAYOUTS_NO_WALLET_DEDUCT.ps1
# Removes wallet-deduct side effects from admin mark_paid.
# Locked rule: payouts must NOT create wallet ledger transactions.

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Info($m) { Write-Host $m -ForegroundColor Cyan }
function Ok($m) { Write-Host $m -ForegroundColor Green }

$root = (Get-Location).Path
$target = Join-Path $root "app\api\admin\driver-payouts\route.ts"

if (!(Test-Path -LiteralPath $target)) {
  Fail "Target not found: $target`nRun this script from repo root."
}

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $target -Raw

$start = "----- PHASE 3N.3 V4: DEDUCT DRIVER WALLET ON MARK_PAID (REST, IDEMPOTENT) -----"
$end   = "----- END PHASE 3N.3 V4 -----"

$si = $txt.IndexOf($start, [System.StringComparison]::Ordinal)
if ($si -lt 0) { Fail "Start marker not found:`n$start`nNo changes made." }

$ei = $txt.IndexOf($end, [System.StringComparison]::Ordinal)
if ($ei -lt 0) { Fail "End marker not found:`n$end`nNo changes made." }

if ($ei -le $si) { Fail "Marker order invalid (end before start). No changes made." }

# Remove from start marker through end marker line (inclusive)
$afterEnd = $ei + $end.Length

# Include the rest of the end-marker line break(s)
while ($afterEnd -lt $txt.Length) {
  $ch = $txt[$afterEnd]
  if ($ch -eq "`r" -or $ch -eq "`n") { $afterEnd++ } else { break }
}

$beforePart = $txt.Substring(0, $si)
$afterPart  = $txt.Substring($afterEnd)
$out = $beforePart + $afterPart

# Light cleanup: collapse 3+ blank lines to max 2 (safe)
$out = [System.Text.RegularExpressions.Regex]::Replace($out, "(\r?\n){3,}", "`r`n`r`n")

# Write UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $out, $utf8NoBom)

Ok "[OK] Patched: removed wallet-deduct block (mark_paid)"
Info "File: $target"
Ok "[DONE]"
