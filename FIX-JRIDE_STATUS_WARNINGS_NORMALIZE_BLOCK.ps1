# FIX-JRIDE_STATUS_WARNINGS_NORMALIZE_BLOCK.ps1
$ErrorActionPreference = "Stop"

function Die([string]$msg) { Write-Host "[ERR] $msg" -ForegroundColor Red; exit 1 }

$root = (Get-Location).Path
$target = Join-Path $root "app\api\dispatch\status\route.ts"
if (!(Test-Path $target)) { Die "Missing file: $target" }

$stamp  = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = "$target.bak.$stamp"
Copy-Item $target $backup -Force
Write-Host "[OK] Backup: $backup"

$txt = Get-Content -LiteralPath $target -Raw

# Repair any literal "\r\n" tokens if present
if ($txt -match '\\r\\n') {
  $txt = $txt -replace '\\r\\n', "`r`n"
  Write-Host "[OK] Converted literal \\r\\n into real newlines."
}

$marker = '// ===== JRIDE_WARNINGS_STABILIZE (AUTO) ====='
if ($txt -notmatch [regex]::Escape($marker)) {
  Die "Could not find warnings stabilize marker block to normalize."
}

# Preferred: replace everything from marker up to the P5C block (your file shows this next)
$anchorNext = '// ===== JRIDE_P5C_POST_START_BLOCK'
$block = @"
  $marker
  let warnings: string[] = [];
  (globalThis as any).__jrideWarnings = warnings;

"@

if ($txt -match ([regex]::Escape($anchorNext))) {
  $rx = [regex]::Escape($marker) + '[\s\S]*?(?=' + [regex]::Escape($anchorNext) + ')'
  $txt2 = [regex]::Replace($txt, $rx, $block, 1)
  if ($txt2 -eq $txt) { Die "Normalize replace made no change (unexpected)." }
  $txt = $txt2
  Write-Host "[OK] Normalized warnings block (marker -> before P5C block)."
} else {
  # Fallback: replace marker line + next ~10 lines to be safe
  $rx = [regex]::Escape($marker) + '([\s\S]*?\r?\n){0,12}'
  $txt2 = [regex]::Replace($txt, $rx, $block, 1)
  if ($txt2 -eq $txt) { Die "Fallback normalize replace made no change (unexpected)." }
  $txt = $txt2
  Write-Host "[OK] Normalized warnings block (marker + following lines)."
}

# Cleanup: remove any immediate duplicate resets that may still exist shortly after the block
# (globalThis as any).__jrideWarnings = [];
# warnings = [];
$cleanupRx = '(?m)^[ \t]*\(\s*globalThis\s+as\s+any\s*\)\.__jrideWarnings\s*=\s*\[\s*\]\s*;\s*\r?\n|^[ \t]*warnings\s*=\s*\[\s*\]\s*;\s*\r?\n'
$txt = [regex]::Replace($txt, $cleanupRx, '', 50)

Set-Content -LiteralPath $target -Value $txt -Encoding UTF8
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "RUN NEXT:" -ForegroundColor Cyan
Write-Host "  npm run build"
