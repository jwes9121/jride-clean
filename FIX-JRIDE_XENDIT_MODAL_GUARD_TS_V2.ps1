# FIX-JRIDE_XENDIT_MODAL_GUARD_TS_V2.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$path = Join-Path $root "components\PaymentMethodModal.tsx"
if (-not (Test-Path $path)) { Fail "Missing: $path" }

Info "Patching: $path"
Copy-Item -Force $path "$path.bak.$(Stamp)"
Ok "Backup created."

$txt = Get-Content -Path $path -Raw

$from = "if (selectedMethod === 'gcash_xendit' && !(process.env.NEXT_PUBLIC_XENDIT_ENABLED === '1')) {"
$to   = "if (((selectedMethod as any) === 'gcash_xendit') && !(process.env.NEXT_PUBLIC_XENDIT_ENABLED === '1')) {"

if ($txt -notlike "*$from*") {
  Fail "Could not find the expected guard line to replace."
}

$txt = $txt.Replace($from, $to)

Set-Content -Path $path -Value $txt -Encoding UTF8
Ok "Patched TS guard (casted selectedMethod)."
