# PROVE-JRIDE_PAYMENTS_REALITY_V1.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$outDir = Join-Path $root ("_payments_proof_" + (Stamp))
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$targets = @(
  "components\PaymentMethodModal.tsx",
  "components\components\PaymentMethodModal.tsx",
  "components\DriverWalletLedger.tsx",
  "components\components\DriverWalletLedger.tsx",
  "app\wallet\page.tsx",
  "app\wallet\topup\page.tsx",
  "app\driver\wallet\page.tsx",
  "app\api\driver\wallet\route.ts",
  "app\api\driver\payout-request\route.ts",
  "app\api\admin\driver-payouts\route.ts",
  "app\api\admin\wallet\adjust\route.ts",
  "app\api\admin\vendor\settle-wallet\route.ts",
  "app\api\takeout\vendor-wallet\route.ts",
  "app\api\takeout\vendor\request-payout\route.ts",
  "app\api\takeout\admin\vendor-payout\settle-request\route.ts"
)

$hits = @()
foreach ($rel in $targets) {
  $p = Join-Path $root $rel
  if (Test-Path $p) {
    $txt = Get-Content $p -Raw
    $sig = [ordered]@{
      file = $rel
      exists = $true
      has_xendit = ($txt -match '(?i)\bxendit\b')
      has_gcash = ($txt -match '(?i)\bgcash\b')
      has_wallet_service = ($txt -match '(?i)/functions/v1/wallet-service')
      has_webhook = ($txt -match '(?i)\bwebhook\b')
      has_checkout = ($txt -match '(?i)\bcheckout\b|\bpayment\b|\bcharge\b')
      has_payout = ($txt -match '(?i)\bpayout\b|\bcashout\b')
      env_xendit_enabled = ($txt -match 'NEXT_PUBLIC_XENDIT_ENABLED')
    }
    $hits += New-Object psobject -Property $sig

    # dump a small excerpt around payment keywords
    $lines = $txt -split "`r?`n"
    $keep = New-Object System.Collections.Generic.List[string]
    for ($i=0; $i -lt $lines.Count; $i++) {
      if ($lines[$i] -match '(?i)\b(gcash|xendit|wallet-service|cashout|payout|topup|checkout|webhook)\b') {
        $start = [Math]::Max(0, $i-3)
        $end = [Math]::Min($lines.Count-1, $i+3)
        $keep.Add("---- $rel : L$($i+1) ----")
        for ($j=$start; $j -le $end; $j++) { $keep.Add($lines[$j]) }
        $keep.Add("")
      }
    }
    if ($keep.Count -gt 0) {
      Set-Content -Path (Join-Path $outDir (($rel -replace '[\\\/:]', '_') + ".snips.txt")) -Value ($keep -join "`r`n") -Encoding UTF8
    }
  } else {
    $hits += New-Object psobject -Property ([ordered]@{ file=$rel; exists=$false })
  }
}

$hits | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $outDir "payments_proof_summary.json") -Encoding UTF8
$hits | Format-Table -AutoSize | Out-String | Set-Content -Path (Join-Path $outDir "payments_proof_summary.txt") -Encoding UTF8

Ok "Wrote:"
Ok "  $outDir\payments_proof_summary.txt"
Ok "  $outDir\payments_proof_summary.json"
Ok "  snips: $outDir\*.snips.txt"
