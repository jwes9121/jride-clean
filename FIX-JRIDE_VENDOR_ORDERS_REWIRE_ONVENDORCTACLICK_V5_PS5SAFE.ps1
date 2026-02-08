# FIX-JRIDE_VENDOR_ORDERS_REWIRE_ONVENDORCTACLICK_V5_PS5SAFE.ps1
# - Backup app/vendor-orders/page.tsx
# - Replace all onClick={onVendorCtaClick} with onClick={openTakeoutTestingNotice}
# - Also replaces any bare "onVendorCtaClick" identifier occurrences (safe targeted)
# - UTF-8 (no BOM)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Die($m){ Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }

function WriteUtf8NoBom($path, $text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

$RepoRoot = (Get-Location).Path
$TargetRel = "app\vendor-orders\page.tsx"
$Target = Join-Path $RepoRoot $TargetRel

if (!(Test-Path $Target)) { Die "Target not found: $TargetRel`nRun from repo root: C:\Users\jwes9\Desktop\jride-clean-fresh" }

# Backup
$bakDir = Join-Path $RepoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir "vendor-orders.page.tsx.bak.$stamp"
Copy-Item -Force $Target $bak
Ok "[OK] Backup: $bak"

$src = Get-Content -Raw -LiteralPath $Target
$before = $src

# Replace the exact onClick usage
$src = [regex]::Replace($src, 'onClick=\{\s*onVendorCtaClick\s*\}', 'onClick={openTakeoutTestingNotice}')

# Safety: if any other JSX props or references still exist, rewrite identifier
# (bounded to word boundary to avoid partial replacements)
$src = [regex]::Replace($src, '\bonVendorCtaClick\b', 'openTakeoutTestingNotice')

if ($src -eq $before) {
  Ok "[OK] No onVendorCtaClick references found (already rewired)."
} else {
  Ok "[OK] Rewired onVendorCtaClick -> openTakeoutTestingNotice."
}

WriteUtf8NoBom $Target $src
Ok "[DONE] Patched: $TargetRel"
Ok "[DONE] Now run: npm.cmd run build"
