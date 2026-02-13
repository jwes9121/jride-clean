$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }

$target = "app\vendor-orders\page.tsx"
if(!(Test-Path $target)){ Fail "Missing file: $target" }

$bak = "$target.bak.$(Stamp)"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $target -Raw

# 1) Remove UTF-8 BOM if present
if($txt.Length -gt 0 -and [int]$txt[0] -eq 0xFEFF){
  $txt = $txt.Substring(1)
  Write-Host "[OK] Removed BOM" -ForegroundColor Green
}

# 2) Rewrite formatAmount() to ASCII-only (PHP)
$fmtPat = '(?s)function\s+formatAmount\s*\(\s*n:\s*number\s*\|\s*null\s*\|\s*undefined\s*\)\s*\{\s*.*?\}\s*'
if($txt -notmatch $fmtPat){ Fail "Could not find function formatAmount(...) block." }

$fmtRep = @"
function formatAmount(n: number | null | undefined) {
  const v = Number(n || 0);
  if (!isFinite(v)) return "PHP 0.00";
  return "PHP " + v.toFixed(2);
}

"@
$txt = [regex]::Replace($txt, $fmtPat, $fmtRep, 1)
Write-Host "[OK] Patched formatAmount() to ASCII-only" -ForegroundColor Green

# 3) Replace common mojibake sequences (safe literal replacements)
# - 'Ã‚·' is a common bad "middle dot" separator -> use pipe
$txt = $txt.Replace("Ã‚·", "|")

# - 'Ã¢â€š±' is bad-encoded peso sign -> remove (we already output PHP)
$txt = $txt.Replace("Ã¢â€š±", "PHP ")

# - Ellipsis char -> ASCII
$txt = $txt.Replace("â€¦", "...")

# 4) Write UTF-8 NO BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllBytes((Resolve-Path $target), $utf8NoBom.GetBytes($txt))
Write-Host "[OK] Wrote UTF-8 NO BOM + cleaned mojibake" -ForegroundColor Green