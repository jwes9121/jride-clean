# SCAN-JRIDE_VEHICLE_TYPE_REFERENCES_V1_1.ps1
# PS5-safe: scans repo for bookings.vehicle_type / vehicle_type / vehicleType
# Writes a Markdown report with file paths + line numbers + snippet.

$ErrorActionPreference = "Stop"

$repoRoot = (Get-Location).Path
$report   = Join-Path $repoRoot "VEHICLE_TYPE_REFERENCES_REPORT.md"

$patterns = @(
  'bookings\.vehicle_type',
  '\bvehicle_type\b',
  '\bvehicleType\b'
)

# Folders to search (tight + safe)
$roots = @(
  (Join-Path $repoRoot 'app'),
  (Join-Path $repoRoot 'src'),
  (Join-Path $repoRoot 'supabase'),
  (Join-Path $repoRoot 'db')
) | Where-Object { Test-Path $_ }

# File types
$includeExt = @('*.ts','*.tsx','*.js','*.jsx','*.sql','*.md')

# Collect candidate files
$files = @()
foreach ($r in $roots) {
  foreach ($ext in $includeExt) {
    $files += Get-ChildItem -Path $r -Recurse -File -Filter $ext -ErrorAction SilentlyContinue
  }
}
$files = $files | Sort-Object FullName -Unique

$sb = New-Object System.Text.StringBuilder
$null = $sb.AppendLine('# VEHICLE_TYPE REFERENCES REPORT')
$null = $sb.AppendLine('')
$null = $sb.AppendLine(('Repo: {0}' -f $repoRoot))
$null = $sb.AppendLine(('Generated: {0}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')))
$null = $sb.AppendLine('')
$null = $sb.AppendLine('Patterns:')
foreach ($p in $patterns) { $null = $sb.AppendLine(('- {0}' -f $p)) }
$null = $sb.AppendLine('')
$null = $sb.AppendLine('---')
$null = $sb.AppendLine('')

$matchCount = 0

foreach ($f in $files) {
  $path = $f.FullName
  $text = $null

  try {
    $text = Get-Content -LiteralPath $path -Raw -ErrorAction Stop
  } catch {
    continue
  }

  $fileHits = @()

  foreach ($pat in $patterns) {
    $rx = [regex]::new($pat, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($rx.IsMatch($text)) {
      $lines = Get-Content -LiteralPath $path -ErrorAction SilentlyContinue
      for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($rx.IsMatch($lines[$i])) {
          $ln = $i + 1
          $snippet = ($lines[$i] | ForEach-Object { $_.Trim() })

          if ($snippet.Length -gt 220) { $snippet = $snippet.Substring(0,220) + '...' }

          $fileHits += [pscustomobject]@{
            Pattern = $pat
            Line    = $ln
            Snippet = $snippet
          }
        }
      }
    }
  }

  if ($fileHits.Count -gt 0) {
    $matchCount += $fileHits.Count
    $rel = $path.Replace($repoRoot, '').TrimStart('\')

    $null = $sb.AppendLine(('## {0}' -f $rel))
    $null = $sb.AppendLine('')
    $null = $sb.AppendLine('| Line | Pattern | Snippet |')
    $null = $sb.AppendLine('| ---: | --- | --- |')

    foreach ($h in $fileHits) {
      $sn = ($h.Snippet -replace '\|','\|')  # escape table pipes
      $null = $sb.AppendLine(('| {0} | {1} | {2} |' -f $h.Line, $h.Pattern, $sn))
    }

    $null = $sb.AppendLine('')
  }
}

$null = $sb.AppendLine('---')
$null = $sb.AppendLine('')
$null = $sb.AppendLine(('Total matches: {0}' -f $matchCount))
$null = $sb.AppendLine('')

$sb.ToString() | Out-File -LiteralPath $report -Encoding UTF8

Write-Host ("[OK] Wrote: {0}" -f $report)
Write-Host ("[OK] Total matches: {0}" -f $matchCount)
