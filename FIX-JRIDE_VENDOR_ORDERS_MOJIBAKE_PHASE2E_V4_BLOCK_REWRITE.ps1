$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = Get-Location
$path = Join-Path $root 'app\vendor-orders\page.tsx'

if (!(Test-Path $path)) { Fail "File not found: app\vendor-orders\page.tsx (run from repo root)" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$ts"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "[OK] Backup: $(Split-Path $bak -Leaf)"

$txt = Get-Content -LiteralPath $path -Raw

# Rewrite the whole block: function formatItemLine(...) ... just before function isSameLocalDay(...)
$pattern = '(?s)function\s+formatItemLine\s*\(\s*it\s*:\s*any\s*\)\s*\{.*?\}\s*function\s+isSameLocalDay\s*\('
if ($txt -notmatch $pattern) {
  Fail "Could not locate the block: formatItemLine(...) ... function isSameLocalDay(. File differs."
}

$replacement = @'
function formatItemLine(it: any) {
  const name = String(it?.name || "");
  const qty = Number(it?.quantity || 0) || 0;
  const price = Number(it?.price || 0) || 0;
  // ASCII-only separator to prevent mojibake regressions
  return `${qty}x ${name} - PHP ${price.toFixed(2)}`;
}
function isSameLocalDay(
'@

$new = [regex]::Replace($txt, $pattern, $replacement, 1)

if ($new -eq $txt) { Fail "Replacement did not apply (no changes made)." }

# Write UTF-8 no BOM
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $new, $utf8)

Ok "[OK] Fixed: Cleaned formatItemLine block and removed leftover mojibake fragment."
Info "NEXT: npm run build"
