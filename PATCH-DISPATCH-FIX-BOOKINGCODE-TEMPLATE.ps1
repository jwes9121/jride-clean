# PATCH-DISPATCH-FIX-BOOKINGCODE-TEMPLATE.ps1
# Fixes the broken JS line:
#   payload.booking_code = ${prefix}-;
# Replaces it with safe string concatenation (no template literals).

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$file = Join-Path $root "app\dispatch\page.tsx"
if (!(Test-Path $file)) { Fail "File not found: $file" }

$ts  = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$file.bak.$ts"
Copy-Item $file $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $file -Raw -Encoding UTF8

# 1) Replace the broken assignment line exactly (most common)
$fixed = $false
if ($txt -match 'payload\.booking_code\s*=\s*\$\{prefix\}\s*-\s*;') {
  $txt = [regex]::Replace(
    $txt,
    'payload\.booking_code\s*=\s*\$\{prefix\}\s*-\s*;',
    'payload.booking_code = prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2, 6);'
  )
  $fixed = $true
  Write-Host "[OK] Fixed broken booking_code assignment (pattern A)." -ForegroundColor Green
}

# 2) If it’s broken in a slightly different way, fix any "payload.booking_code = ${prefix}..." fragment
if (!$fixed -and ($txt -match 'payload\.booking_code\s*=\s*\$\{prefix\}')) {
  $txt = [regex]::Replace(
    $txt,
    'payload\.booking_code\s*=\s*\$\{prefix\}[^;\r\n]*;?',
    'payload.booking_code = prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2, 6);'
  )
  $fixed = $true
  Write-Host "[OK] Fixed broken booking_code assignment (pattern B)." -ForegroundColor Green
}

# 3) Sanity: ensure the "Ensure booking_code exists" block (if present) contains a valid assignment
if ($txt -match 'Ensure booking_code exists') {
  if ($txt -notmatch 'payload\.booking_code\s*=\s*prefix\s*\+\s*"-"\s*\+\s*Date\.now\(\)') {
    Write-Host "[WARN] Found the booking_code block, but did not detect the expected fixed assignment. Please search for 'booking_code' in page.tsx." -ForegroundColor Yellow
  }
} else {
  Write-Host "[WARN] Did not find the 'Ensure booking_code exists' comment. If you still get Missing bookingCode, we can add it cleanly next." -ForegroundColor Yellow
}

Set-Content -Path $file -Value $txt -Encoding UTF8
Write-Host "[OK] Patched: $file" -ForegroundColor Green

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1) npm run dev" -ForegroundColor Cyan
Write-Host "  2) Open http://localhost:3000/dispatch" -ForegroundColor Cyan
Write-Host "  3) Confirm Create works (no 'Missing bookingCode')" -ForegroundColor Cyan
