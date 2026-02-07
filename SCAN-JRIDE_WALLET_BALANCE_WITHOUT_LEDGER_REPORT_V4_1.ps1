# SCAN-JRIDE_WALLET_BALANCE_WITHOUT_LEDGER_REPORT_V4_1.ps1
# PS5-safe: scans app/api + app/admin for files containing "wallet_balance"
# but NOT containing "driver_wallet_transactions", outputs a markdown report.
# UTF-8 no BOM output.

$ErrorActionPreference = "Stop"

function NowStamp() {
  return (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
}

function Write-TextUtf8NoBom($path, $content) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $enc)
}

$repo = (Get-Location).Path
$roots = @(
  (Join-Path $repo "app\api"),
  (Join-Path $repo "app\admin")
)

$want = "wallet_balance"
$not  = "driver_wallet_transactions"

$rows = @()

foreach ($root in $roots) {
  if (!(Test-Path -LiteralPath $root)) { continue }

  $files = Get-ChildItem -LiteralPath $root -Recurse -File -Include *.ts,*.tsx -ErrorAction SilentlyContinue
  foreach ($f in $files) {
    $txt = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)

    if ($txt -match $want) {
      if (!($txt -match $not)) {

        # first line containing wallet_balance
        $snip = ""
        $lines = $txt -split "`r?`n"
        for ($i = 0; $i -lt $lines.Length; $i++) {
          if ($lines[$i] -match $want) {
            $snip = $lines[$i].Trim()
            break
          }
        }

        $rel = $f.FullName.Substring($repo.Length).TrimStart("\","/")

        $rows += [PSCustomObject]@{
          file    = $rel
          snippet = $snip
        }
      }
    }
  }
}

$sb = New-Object System.Text.StringBuilder
$null = $sb.AppendLine("# JRIDE - Files containing 'wallet_balance' but NOT 'driver_wallet_transactions'")
$null = $sb.AppendLine("")
$null = $sb.AppendLine("- Generated: " + (NowStamp))
$null = $sb.AppendLine("")
$null = $sb.AppendLine("| file | snippet |")
$null = $sb.AppendLine("| --- | --- |")

if ($rows.Count -eq 0) {
  $null = $sb.AppendLine("| (none) | (none) |")
} else {
  $sorted = $rows | Sort-Object file
  foreach ($r in $sorted) {
    $f = ($r.file + "").Replace("|", "\|")
    $s = ($r.snippet + "").Replace("|", "\|")
    if ($s.Length -gt 200) { $s = $s.Substring(0, 200) + "..." }

    # IMPORTANT: no backticks in this row (PowerShell escape char)
    $line = "| " + $f + " | " + $s + " |"
    $null = $sb.AppendLine($line)
  }
}

$outPath = Join-Path $repo "WALLET_BALANCE_WITHOUT_LEDGER_REPORT.md"
Write-TextUtf8NoBom $outPath $sb.ToString()

Write-Host ("[OK] Wrote: " + $outPath)
Write-Host ("[OK] Matches: " + $rows.Count)
