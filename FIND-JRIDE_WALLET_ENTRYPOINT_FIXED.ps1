# FIND-JRIDE_WALLET_ENTRYPOINT_FIXED.ps1
# Read-only scan. PowerShell 5. ASCII only.

$ErrorActionPreference = "Stop"

function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$root = Get-Location
$targets = @(
  "driver_wallet_transactions",
  "vendor_wallet_transactions",
  "wallet_transactions",
  "driver_payout",
  "vendor_payout",
  "wallet_cut",
  "platform_fee",
  "process_booking_wallet",
  "process_booking_wallet_cut",
  "wallet",
  "payout"
)

$include = @("*.ts","*.tsx","*.sql")
$paths = @(
  (Join-Path $root "app"),
  (Join-Path $root "utils"),
  (Join-Path $root "lib"),
  (Join-Path $root "supabase")
) | Where-Object { Test-Path $_ }

Info "Scanning for wallet/payout entrypoints..."
Info ("Roots: " + ($paths -join ", "))

$hits = @()

foreach ($p in $paths) {
  foreach ($t in $targets) {
    $m = Select-String -Path (Join-Path $p "**\*") -Include $include -Pattern $t -SimpleMatch -ErrorAction SilentlyContinue
    foreach ($x in $m) {
      $hits += [pscustomobject]@{
        Pattern = $t
        File    = $x.Path
        Line    = $x.LineNumber
        Text    = ($x.Line.Trim())
      }
    }
  }
}

if (-not $hits.Count) {
  Write-Host "NO MATCHES FOUND." -ForegroundColor Yellow
  exit 0
}

# De-dupe by file+line+pattern
$hits = $hits | Sort-Object File, Line, Pattern -Unique

# Rank likely entrypoints higher
$ranked = $hits | ForEach-Object {
  $score = 0
  if ($_.Text -match "from\(" -or $_.Text -match "\.insert\(") { $score += 3 }
  if ($_.Text -match "\.rpc\(") { $score += 3 }
  if ($_.Pattern -match "driver_wallet_transactions|vendor_wallet_transactions") { $score += 5 }
  if ($_.Pattern -match "process_booking_wallet|wallet_cut") { $score += 4 }

  [pscustomobject]@{
    Score   = $score
    Pattern = $_.Pattern
    File    = $_.File
    Line    = $_.Line
    Text    = $_.Text
  }
} | Sort-Object -Property Score, File, Line -Descending

Ok ("Found " + $ranked.Count + " matches. Showing top 40 (highest score first):")
$ranked | Select-Object -First 40 | Format-Table -AutoSize Score, Pattern, Line, File

Write-Host ""
Info "NEXT: Upload ONE file that is the wallet ledger writer (insert into driver/vendor_wallet_transactions OR rpc wallet function)."
