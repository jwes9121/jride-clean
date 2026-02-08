# FIX-JRIDE_VENDOR_ORDERS_REMOVE_BAD_WRAPPERS_V7_PS5SAFE.ps1
# PS5-safe:
# - Backup app/vendor-orders/page.tsx
# - Remove injected "<div onClickCapture={jrideVendorIntercept}>" that appears BEFORE VendorOrdersPage
#   (this fixes helper functions like isToday() that must return boolean expressions)
# - Also removes a matching stray "</div>" before ");" in the preamble, if present
# - Does NOT require uploads
# - UTF-8 (no BOM)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }

function WriteUtf8NoBom($path, $text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

$RepoRoot = (Get-Location).Path
$TargetRel = "app\vendor-orders\page.tsx"
$Target = Join-Path $RepoRoot $TargetRel

if (!(Test-Path $Target)) {
  Die "Target not found: $Target`nRun from repo root: C:\Users\jwes9\Desktop\jride-clean-fresh"
}

# Backup
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $RepoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir ("vendor-orders.page.tsx.bak.$stamp")
Copy-Item -Force $Target $bak
Ok "[OK] Backup: $bak"

$src = Get-Content -Raw -LiteralPath $Target

# Find VendorOrdersPage start index (we only clean BEFORE this)
$m = [regex]::Match($src, 'export\s+default\s+function\s+VendorOrdersPage\s*\(')
if (!$m.Success) {
  Die "Could not find 'export default function VendorOrdersPage(' in $TargetRel"
}
$cut = $m.Index

$preamble = $src.Substring(0, $cut)
$rest     = $src.Substring($cut)

$before = $preamble

# Remove the bad wrapper OPEN tag injected after any "return ("
# This specifically fixes:
# return (
#   <div onClickCapture={jrideVendorIntercept}>
#   someBooleanExpression...
$preamble = [regex]::Replace(
  $preamble,
  '(?s)return\s*\(\s*\r?\n\s*<div\s+onClickCapture=\{jrideVendorIntercept\}>\s*\r?\n',
  "return (`r`n",
  0
)

# Remove any stray wrapper CLOSE tag in preamble (rare, but safe)
# e.g. inserted right before ");" somewhere:
$preamble = [regex]::Replace(
  $preamble,
  '(?m)^\s*</div>\s*\r?$',
  '',
  0
)

# Also remove any modal block accidentally injected into preamble (extra safety)
$preamble = [regex]::Replace(
  $preamble,
  '(?s)\{showPilotNotice\s*&&\s*\(.*?\)\s*\}\s*',
  '',
  0
)

if ($preamble -eq $before) {
  Warn "[WARN] No bad wrappers found before VendorOrdersPage (preamble unchanged)."
} else {
  Ok "[OK] Removed bad wrapper(s) from helper returns before VendorOrdersPage."
}

# Reassemble
$src2 = $preamble + $rest

# Write UTF-8 (no BOM)
WriteUtf8NoBom $Target $src2
Ok "[OK] Patched: $TargetRel"
Ok "[DONE] Now run: npm.cmd run build"
