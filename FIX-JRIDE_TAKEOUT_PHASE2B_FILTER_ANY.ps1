# FIX-JRIDE_TAKEOUT_PHASE2B_FILTER_ANY.ps1
# Fix TS error: Parameter 'r' implicitly has an 'any' type in app/takeout/page.tsx
# UTF-8 no BOM + backup

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$root = Get-Location
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$target = Join-Path $root "app\takeout\page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

Copy-Item -Force $target "$target.bak.$ts"
Ok "Backup: $target.bak.$ts"

$txt = [System.IO.File]::ReadAllText($target)

$needle = ".filter((r) => r.id && r.name);"
$repl   = ".filter((r: MenuItem) => r.id && r.name);"

if ($txt -notmatch [regex]::Escape($needle)) {
  Fail "Anchor not found: $needle`nPaste the lines around the failing .filter() and I'll adjust."
}

$txt2 = $txt.Replace($needle, $repl)

[System.IO.File]::WriteAllText($target, $txt2, $utf8NoBom)
Ok "Patched: $target"
Ok "TypeScript any-filter fixed."
