# PATCH-JRIDE_PHASE3M3_FIX_ROUTE_SUMMARY_VAR_V2.ps1
# Fixes TypeScript error: skipped_existing_credit not in scope
# Updates summary to reference skipped_existing
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
$target = Join-Path $root "app\api\admin\reconcile-wallets\fix\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $target "$target.bak.$ts" -Force
Ok "[OK] Backup: $target.bak.$ts"

$txt = Get-Content $target -Raw

# Replace the shorthand property with an explicit mapping
$txt2 = $txt -replace "(\s*)skipped_existing_credit\s*,", "`$1skipped_existing_credit: skipped_existing,"

if ($txt2 -eq $txt) {
  Fail "Anchor not found: skipped_existing_credit (no changes made). Paste lines ~168-178 from the file."
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt2, $utf8NoBom)

Ok "[OK] Patched: $target"
Ok "DONE"
