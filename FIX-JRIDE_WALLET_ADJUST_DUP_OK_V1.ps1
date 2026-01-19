# FIX-JRIDE_WALLET_ADJUST_DUP_OK_V1.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$path = Join-Path $root "app\api\admin\wallet\adjust\route.ts"
if (-not (Test-Path $path)) { Fail "Missing: $path" }

Info "Patching: $path"
Copy-Item -Force $path "$path.bak.$(Stamp)"
Ok "Backup created."

$txt = Get-Content -Path $path -Raw

$from = "if (!r.ok) return json(502, { ok: false, code: ""RPC_FAILED"", stage: ""admin_adjust_driver_wallet"", ...r });"
$to   = "if (!r.ok) return json(502, { ok: false, code: ""RPC_FAILED"", stage: ""admin_adjust_driver_wallet"", details: r });"

if ($txt -notlike "*$from*") {
  Fail "Could not find the exact line to patch. Paste the failing block from route.ts if it differs."
}

$txt = $txt.Replace($from, $to)

Set-Content -Path $path -Value $txt -Encoding UTF8
Ok "Patched duplicate ok spread (details: r)."
