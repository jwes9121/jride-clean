# PATCH-JRIDE_PHASE6A1_VENDOR_PAYOUTS_SUMMARY_NAME_FIX.ps1
# Fixes table name mismatch:
#   admin_vendor_payouts_summary -> admin_vendor_payout_summary
# READ-ONLY, SAFE

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }

$root = (Get-Location).Path
$target = Join-Path $root "app\api\admin\vendor-payouts-summary\route.ts"

if (!(Test-Path -LiteralPath $target)) {
  Fail "Target not found: $target"
}

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $target -Raw

if ($txt -notmatch "admin_vendor_payouts_summary") {
  Fail "Expected string not found. File may already be patched."
}

$txt = $txt.Replace(
  "admin_vendor_payouts_summary",
  "admin_vendor_payout_summary"
)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt, $utf8NoBom)

Ok "[OK] Patched summary table name"
Ok "[DONE]"
