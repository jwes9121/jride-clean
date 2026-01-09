$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = Get-Location
$path = Join-Path $root 'app\vendor-orders\page.tsx'
if (!(Test-Path $path)) { Fail "Missing: app\vendor-orders\page.tsx (run from repo root)" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$ts"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "[OK] Backup: $(Split-Path $bak -Leaf)"

$txt = Get-Content -LiteralPath $path -Raw

# 1) Hard rewrite: formatItemLine(...) block until just before isSameLocalDay(
$patternBlock = '(?s)function\s+formatItemLine\s*\(\s*it\s*:\s*any\s*\)\s*\{.*?\}\s*function\s+isSameLocalDay\s*\('
if ($txt -notmatch $patternBlock) {
  Fail "Could not locate block: formatItemLine(...) ... function isSameLocalDay(. File differs."
}

$replacementBlock = @'
function formatItemLine(it: any) {
  const name = (typeof normText === "function") ? normText(it?.name || "") : String(it?.name || "");
  const qty = Number(it?.quantity || 0) || 0;
  const price = Number(it?.price || 0) || 0;
  // ASCII-only separator to prevent mojibake regressions
  return `${qty}x ${name} - PHP ${price.toFixed(2)}`;
}
function isSameLocalDay(
'@

$txt2 = [regex]::Replace($txt, $patternBlock, $replacementBlock, 1)

# 2) Extra cleanup: remove any stray fragment lines like: x ${name} - PHP ${price.toFixed(2)}`;
# (These are always invalid outside a template literal context)
$txt3 = [regex]::Replace($txt2, '(?m)^\s*x\s+\$\{name\}.*\r?\n', '', 0)

# Write UTF-8 no BOM
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $txt3, $utf8)

Ok "[OK] Cleaned: removed stray fragment and rebuilt formatItemLine block safely."
Info "NEXT: npm run build"
