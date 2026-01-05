# FIX-JRIDE_VENDOR_V3_ORDERID_TO_ID.ps1
# Fix: replace undefined orderId with id in the VENDOR_CORE_V3_UI_SYNC injected setOrders block
# File: app/vendor-orders/page.tsx

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }

$rel = "app\vendor-orders\page.tsx"
$path = Join-Path (Get-Location).Path $rel
if (!(Test-Path $path)) { Fail "File not found: $path (run from repo root)" }

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

# Target only the injected V3 block to avoid changing other code
$blockPat = '(?s)//\s*VENDOR_CORE_V3_UI_SYNC\s*\(safe local update, backend-confirmed by reload\).*?setOrders\(\(prev\)\s*=>\s*.*?\);\s*'
if ($txt -notmatch $blockPat) { Fail "V3 injected block not found." }

$block = [regex]::Match($txt, $blockPat).Value
$block2 = $block -replace '\borderId\b', 'id'

if ($block2 -eq $block) { Fail "No 'orderId' found inside V3 block to replace." }

$txt = $txt.Replace($block, $block2)

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Ok "Replaced orderId -> id inside V3 injected block."
