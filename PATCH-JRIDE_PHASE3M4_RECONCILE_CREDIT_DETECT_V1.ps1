# PATCH-JRIDE_PHASE3M4_RECONCILE_CREDIT_DETECT_V1.ps1
# Expands reconcile-wallets credit detection to include backfill/reconcile reasons.
# Fixes mismatch where existing "reconcile_backfill ..." tx are not counted as credits.
# UTF-8 without BOM

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }

function Find-RepoRoot([string]$startDir) {
  $d = Resolve-Path $startDir
  while ($true) {
    if (Test-Path (Join-Path $d "package.json")) { return $d }
    $parent = Split-Path $d -Parent
    if ($parent -eq $d) { break }
    $d = $parent
  }
  Fail "Could not find repo root (package.json)."
}

$root = Find-RepoRoot (Get-Location).Path
$target = Join-Path $root "app\api\admin\reconcile-wallets\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $target "$target.bak.$ts" -Force
Ok "[OK] Backup: $target.bak.$ts"

$txt = Get-Content $target -Raw

# Patch ONLY the isCreditTx() return expression
# Old:
#   return r.includes("credit") || r.includes("earning") || r.includes("earnings");
# New adds backfill + reconcile + reconcile_backfill (covered by backfill/reconcile)
$pattern = 'return\s+r\.includes\("credit"\)\s*\|\|\s*r\.includes\("earning"\)\s*\|\|\s*r\.includes\("earnings"\)\s*;'
$replacement = 'return r.includes("credit") || r.includes("earning") || r.includes("earnings") || r.includes("backfill") || r.includes("reconcile");'

$txt2 = [regex]::Replace($txt, $pattern, $replacement, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)

if ($txt2 -eq $txt) {
  Fail "Could not find expected isCreditTx return line. Paste the isCreditTx() function from $target."
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt2, $utf8NoBom)

Ok "[OK] Patched: $target"
Ok "DONE"
