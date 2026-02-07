# ================================
# JRIDE - Scan: wallet_balance WITHOUT driver_wallet_transactions
# Version: V1.2 (PS5-safe, ASCII-only, NO backticks)
# Mode: READ-ONLY (writes report only)
# ================================

$ErrorActionPreference = "Stop"

$ROOT = (Get-Location).Path
$targets = @(
  (Join-Path $ROOT "app\api"),
  (Join-Path $ROOT "app\admin")
)

$OUT = Join-Path $ROOT "WALLET_BALANCE_WITHOUT_LEDGER_REPORT.md"

function Read-AllTextSafe([string]$path) {
  return [System.IO.File]::ReadAllText($path)
}

$rows = @()

foreach ($base in $targets) {
  if (!(Test-Path $base)) { continue }

  Get-ChildItem -Path $base -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @(".ts", ".tsx") } |
    ForEach-Object {

      $file = $_.FullName
      $rel  = $file.Replace($ROOT + "\", "")

      $txt = $null
      try { $txt = Read-AllTextSafe $file } catch { return }

      $hasWalletBalance = ($txt -match "wallet_balance")
      $hasLedger        = ($txt -match "driver_wallet_transactions")

      if ($hasWalletBalance -and (-not $hasLedger)) {

        # Extract up to 3 line-context snippets containing wallet_balance
        $lines = $txt -split "(\r\n|\n|\r)"
        $snips = New-Object System.Collections.Generic.List[string]

        for ($i = 0; $i -lt $lines.Length; $i++) {
          if ($lines[$i] -match "wallet_balance") {
            $start = [Math]::Max(0, $i - 1)
            $end   = [Math]::Min($lines.Length - 1, $i + 1)

            $snippet = ($lines[$start..$end] -join " | ").Trim()
            if ($snippet.Length -gt 200) { $snippet = $snippet.Substring(0, 200) + "..." }

            $snips.Add($snippet) | Out-Null
            if ($snips.Count -ge 3) { break }
          }
        }

        $rows += [pscustomobject]@{
          file    = $rel
          folder  = (Split-Path $rel -Parent)
          snippet = ($snips -join " / ")
        }
      }
    }
}

$rows = $rows | Sort-Object file

# Write report (NO backticks in output)
$sb = New-Object System.Text.StringBuilder
$null = $sb.AppendLine("# JRIDE - Files containing wallet_balance but NOT driver_wallet_transactions")
$null = $sb.AppendLine("")
$null = $sb.AppendLine("Generated: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
$null = $sb.AppendLine("")
$null = $sb.AppendLine("| File | Folder | Evidence (context) |")
$null = $sb.AppendLine("|------|--------|-------------------|")

foreach ($r in $rows) {
  $f = ($r.file   -replace "\|","/")
  $w = ($r.folder -replace "\|","/")
  $s = ($r.snippet -replace "\|","/")

  $null = $sb.AppendLine("| " + $f + " | " + $w + " | " + $s + " |")
}

Set-Content -Path $OUT -Value $sb.ToString() -Encoding UTF8

# Console output
Write-Host ""
Write-Host "== MATCHES (wallet_balance present, driver_wallet_transactions absent) ==" -ForegroundColor Cyan

if ($rows.Count -eq 0) {
  Write-Host "(none found)" -ForegroundColor Yellow
} else {
  foreach ($r in $rows) {
    Write-Host ("- " + $r.file)
  }
}

Write-Host ""
Write-Host ("Report written: " + $OUT) -ForegroundColor Green
