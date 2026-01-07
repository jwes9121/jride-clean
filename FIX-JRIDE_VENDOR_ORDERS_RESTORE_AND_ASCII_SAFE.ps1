# FIX-JRIDE_VENDOR_ORDERS_RESTORE_AND_ASCII_SAFE.ps1
$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }

$target = "app\vendor-orders\page.tsx"
if(!(Test-Path $target)){ Fail "Missing file: $target" }

# 1) Restore from latest backup
$dir = Split-Path $target -Parent
$bak = Get-ChildItem $dir -File -Filter 'page.tsx.bak.*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if(-not $bak){ Fail "No page.tsx.bak.* found in $dir" }

Copy-Item $bak.FullName $target -Force
Write-Host ("[OK] Restored from: " + $bak.Name) -ForegroundColor Green

$txt = Get-Content $target -Raw

# 2) Rewrite formatAmount() to ASCII-only (PHP)
$patAmt = '(?s)function\s+formatAmount\s*\(\s*n:\s*number\s*\|\s*null\s*\|\s*undefined\s*\)\s*\{.*?\}\s*'
if($txt -match $patAmt){
  $repAmt = @"
function formatAmount(n: number | null | undefined) {
  const v = Number(n || 0);
  if (!isFinite(v)) return "PHP 0.00";
  return "PHP " + v.toFixed(2);
}

"@
  $txt = [regex]::Replace($txt, $patAmt, $repAmt, 1)
  Write-Host "[OK] Rewrote formatAmount() to ASCII-only" -ForegroundColor Green
} else {
  Write-Host "[WARN] formatAmount() not found (skipped)" -ForegroundColor Yellow
}

# 3) Replace the mojibake vGeoLast span with ASCII text
#    Match: <span className="opacity-80"> ... {vGeoLast.lat.toFixed(5)},{vGeoLast.lng.toFixed(5)}</span>
$patLast = '(?s)<span\s+className="opacity-80">\s*.*?\{vGeoLast\.lat\.toFixed\(5\)\}\s*,\s*\{vGeoLast\.lng\.toFixed\(5\)\}\s*</span>'
$repLast = '<span className="opacity-80">Last: {vGeoLast.lat.toFixed(5)},{vGeoLast.lng.toFixed(5)}</span>'

if($txt -match $patLast){
  $txt = [regex]::Replace($txt, $patLast, $repLast, 1)
  Write-Host "[OK] Replaced mojibake geo-last span with ASCII" -ForegroundColor Green
} else {
  Write-Host "[WARN] geo-last mojibake span not found (skipped)" -ForegroundColor Yellow
}

# 4) Write UTF-8 NO BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllBytes((Resolve-Path $target), $utf8NoBom.GetBytes($txt))
Write-Host "[OK] Wrote UTF-8 no BOM: app\vendor-orders\page.tsx" -ForegroundColor Green
