# PATCH-JRIDE_PHASE11D_RIDE_UI_CLEANUP_SAFE.ps1
# Fixes normUpper syntax error and hides verification/wallet panels when unauthenticated
# ASCII only, PowerShell 5 compatible

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }

$target = "app\ride\page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

$txt = Get-Content $target -Raw
$orig = $txt

# 1) Fix broken normUpper function
$txt = $txt -replace 'function\s+normUpper\s*\r?\n\s*\(', 'function normUpper('

# 2) Hide verification panel if note says "not signed in"
$txt = $txt -replace `
'\{canInfo\s*&&\s*canInfo\.verification_note\s*\?\s*\(', `
'{canInfo && canInfo.verification_note && canInfo.verification_note.toLowerCase().indexOf("not signed in") < 0 ? ('

# 3) Hide wallet panel if note says "not signed in"
$txt = $txt -replace `
'\{canInfo\s*&&\s*canInfo\.wallet_note\s*!==\s*undefined\s*\?\s*\(', `
'{canInfo && canInfo.wallet_note !== undefined && String(canInfo.wallet_note).toLowerCase().indexOf("not signed in") < 0 ? ('

if ($txt -eq $orig) {
  Fail "No changes produced (unexpected)."
}

[System.IO.File]::WriteAllText($target, $txt, [System.Text.Encoding]::UTF8)
Ok "Ride UI fixed and cleaned."
