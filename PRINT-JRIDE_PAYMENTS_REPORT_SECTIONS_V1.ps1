# PRINT-JRIDE_PAYMENTS_REPORT_SECTIONS_V1.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = (Get-Location).Path

$latest = Get-ChildItem -Path $root -Directory -Filter "_payments_scan_report_*" |
  Sort-Object Name -Descending |
  Select-Object -First 1

if (-not $latest) { throw "No _payments_scan_report_* folder found." }

$txt = Join-Path $latest.FullName "payments_implementation_report.txt"
if (-not (Test-Path $txt)) { throw "Missing: $txt" }

$content = Get-Content -Path $txt -Raw

function PrintSection($title) {
  $start = $content.IndexOf($title)
  if ($start -lt 0) {
    Write-Host "`n[SECTION NOT FOUND] $title`n"
    return
  }
  # find next section header
  $next = $content.IndexOf("=== ", $start + 4)
  if ($next -lt 0) { $next = $content.Length }
  $block = $content.Substring($start, $next - $start).Trim()
  Write-Host "`n" + $block + "`n"
}

PrintSection "=== 1) Provider / Payment Keywords Found ==="
PrintSection "=== 2) API Route Candidates (payments/wallet/webhooks) ==="
PrintSection "=== 3) Env / Config Hints ==="
