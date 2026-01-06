# FIX-JRIDE_VENDOR_V3_REWRITE_LOCAL_UPDATE_BLOCK.ps1
# Fix: rewrite the V3 local update block to avoid undefined orderId
# File: app/vendor-orders/page.tsx

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$rel = "app\vendor-orders\page.tsx"
$path = Join-Path (Get-Location).Path $rel
if (!(Test-Path $path)) { Fail "File not found: $path (run from repo root)" }

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

# Detect whether the function uses nextStatus or newStatus
$usesNext = $txt -match '\bnextStatus\b'
$usesNew  = $txt -match '\bnewStatus\b'
$statusVar = "nextStatus"
if (-not $usesNext -and $usesNew) { $statusVar = "newStatus" }

# Our new block (always uses id, never orderId)
$newBlock = @"
      // VENDOR_CORE_V3_UI_SYNC (safe local update, backend-confirmed by reload)
      setOrders((prev) =>
        prev.map((o) => (o.id === id ? { ...o, status: ($statusVar as any) } : o))
      );
"@

# Replace any existing V3 local update block starting from the V3 comment until the next "}" indentation line OR catch/error line
# We keep it conservative: replace from comment through the following setOrders(...) statement.
$pat = '(?s)//\s*VENDOR_CORE_V3_UI_SYNC\s*\(safe local update, backend-confirmed by reload\)\s*.*?\bsetOrders\s*\(\(prev\)\s*=>\s*.*?\);\s*'
if ($txt -notmatch $pat) {
  Fail "Could not locate the V3 local update block. Search for the V3 comment in app/vendor-orders/page.tsx."
}

$txt2 = [regex]::Replace($txt, $pat, $newBlock, 1)

Set-Content -LiteralPath $path -Value $txt2 -Encoding UTF8
Ok "Patched: $rel"
Ok "Rewrote V3 local update block to use id (no orderId)."
