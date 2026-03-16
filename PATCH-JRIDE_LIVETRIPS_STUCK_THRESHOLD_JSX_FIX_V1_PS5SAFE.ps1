param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$m) { Write-Host $m -ForegroundColor Cyan }
function Write-Ok([string]$m) { Write-Host $m -ForegroundColor Green }
function Write-Warn([string]$m) { Write-Host $m -ForegroundColor Yellow }

$target = Join-Path $RepoRoot "app\admin\livetrips\LiveTripsClient.tsx"
if (-not (Test-Path $target)) {
  throw "Target file not found: $target"
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.STUCK_TEXT_FIX_V1.$stamp"
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Ok "[OK] Backup: $bak"

$content = Get-Content -LiteralPath $target -Raw -Encoding UTF8

$old = '<div>on_the_way >= {STUCK_THRESHOLDS_MIN.on_the_way} min, on_trip >= {STUCK_THRESHOLDS_MIN.on_trip} min</div>'
$new = '<div>on_the_way {">="} {STUCK_THRESHOLDS_MIN.on_the_way} min, on_trip {">="} {STUCK_THRESHOLDS_MIN.on_trip} min</div>'

if ($content.Contains($old)) {
  $content = $content.Replace($old, $new)
  Write-Ok "[OK] Replaced exact stuck-threshold JSX line"
} else {
  $pattern = '(?m)^(?<indent>\s*)<div>\s*on_the_way\s*>?=\s*\{STUCK_THRESHOLDS_MIN\.on_the_way\}\s*min,\s*on_trip\s*>?=\s*\{STUCK_THRESHOLDS_MIN\.on_trip\}\s*min\s*</div>\s*$'
  $replacement = '${indent}<div>on_the_way {">="} {STUCK_THRESHOLDS_MIN.on_the_way} min, on_trip {">="} {STUCK_THRESHOLDS_MIN.on_trip} min</div>'
  $next = [regex]::Replace($content, $pattern, $replacement)
  if ($next -ne $content) {
    $content = $next
    Write-Ok "[OK] Replaced regex-matched stuck-threshold JSX line"
  } else {
    throw "Could not find the exact/regex stuck-threshold JSX line to replace."
  }
}

# Keep file ASCII-clean for the existing prebuild guard
$content = [regex]::Replace($content, '[^\x00-\x7F]', '')

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $content, $utf8NoBom)
Write-Ok "[OK] Wrote: $target"

$lines = (Get-Content -LiteralPath $target -Raw -Encoding UTF8) -split "`r?`n"
$start = [Math]::Max(0, 468)
$end = [Math]::Min($lines.Length - 1, 476)
Write-Info "---- New lines 469-477 ----"
for ($i = $start; $i -le $end; $i++) {
  $ln = $i + 1
  Write-Host ("{0}: {1}" -f $ln, $lines[$i])
}
Write-Info "---------------------------"

Write-Host ""
Write-Info "Next command"
Write-Host "npm run build"
