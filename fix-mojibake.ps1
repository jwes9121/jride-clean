Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = (Get-Location).Path
Write-Host ("Repo: " + $root)

# Unicode pattern for mojibake lead bytes:
# U+00C3 (Ã) and U+00C2 ()
$pattern = "[\u00C2\u00C3]"

# Collect TS/TSX files (exclude node_modules/.next/etc)
$targets = Get-ChildItem -Path $root -Recurse -File -Include *.ts,*.tsx |
  Where-Object { $_.FullName -notmatch '\\node_modules\\|\\.next\\|\\dist\\|\\out\\' }

# Find all lines containing the mojibake marker chars
$hits = @()
foreach ($f in $targets) {
  $m = Select-String -Path $f.FullName -Pattern $pattern -AllMatches -ErrorAction SilentlyContinue
  if ($m) { $hits += $m }
}

if (-not $hits -or $hits.Count -eq 0) {
  Write-Host "[OK] No mojibake markers found in TS/TSX files."
  exit 0
}

Write-Host ""
Write-Host "=== FOUND MOJIBAKE MARKERS ===" -ForegroundColor Yellow

# Print summary table
$rows = foreach ($h in $hits) {
  [pscustomobject]@{
    File = $h.Path
    Line = $h.LineNumber
    Text = ($h.Line.Trim())
  }
}
$rows | Sort-Object File, Line | Format-Table -AutoSize

# Backup + patch only affected files
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$filesToPatch = $rows | Select-Object -ExpandProperty File -Unique

Write-Host ""
Write-Host "=== PATCHING FILES ===" -ForegroundColor Cyan

foreach ($file in $filesToPatch) {
  $bak = "$file.bak_$stamp"
  Copy-Item -LiteralPath $file -Destination $bak -Force
  Write-Host ("Backup: " + $bak)

  $c = Get-Content -LiteralPath $file -Raw

  # Remove sequences starting with U+00C2 or U+00C3 up to tag boundary "<" or end-of-line
  $rx = "[\u00C2\u00C3][^\r\n<]*"
  $c2 = [regex]::Replace($c, $rx, "")

  # Normalize extra spaces created by stripping
  $c2 = [regex]::Replace($c2, "[ \t]{2,}", " ")

  if ($c2 -ne $c) {
    Set-Content -LiteralPath $file -Value $c2 -Encoding UTF8
    Write-Host ("Patched: " + $file) -ForegroundColor Green
  } else {
    Write-Host ("No change: " + $file)
  }
}

Write-Host ""
Write-Host "[DONE] Mojibake cleaned. Restart dev server now." -ForegroundColor Green
