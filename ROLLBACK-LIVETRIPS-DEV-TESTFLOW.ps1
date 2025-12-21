# ROLLBACK-LIVETRIPS-DEV-TESTFLOW.ps1
# Removes the Dev Test Flow code that was injected into LiveTripsClient.tsx
# Restores build. Does NOT touch Mapbox/layout.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$txt  = Get-Content -Raw -Encoding UTF8 $f
$orig = $txt

# 1) Remove the injected helper function
$txt = [regex]::Replace(
  $txt,
  '(?s)\r?\n\s*async function devTestSetStatus\s*\([^)]*\)\s*\{.*?\}\s*\r?\n',
  "`r`n",
  1
)

# 2) Remove the injected isDev const (only the specific block we inserted)
$txt = [regex]::Replace(
  $txt,
  '(?s)\r?\n\s*const isDev\s*=\s*\r?\n\s*process\.env\.NODE_ENV\s*===\s*"development"\s*\|\|\s*\r?\n\s*\(typeof window !== "undefined" && window\.location\.hostname === "localhost"\);\s*\r?\n',
  "`r`n",
  1
)

# 3) Remove the injected dev UI block (anchored by its unique header)
$txt = [regex]::Replace(
  $txt,
  '(?s)\{isDev\s*\?\s*\(\s*<div[^>]*>[\s\S]*?Dev Test Flow \(local only\)[\s\S]*?<\/div>\s*\)\s*:\s*null\s*\}',
  '',
  1
)

# 4) Also remove any remaining "Dev Test Flow" fragments if partially injected
$txt = $txt -replace '(?s)\r?\n.*Dev Test Flow \(local only\).*?\r?\n', "`r`n"

if ($txt -eq $orig) {
  Fail "No Dev Test Flow code found to remove (file may have been edited differently)."
}

Set-Content -Path $f -Value $txt -Encoding UTF8
Write-Host "OK: Removed Dev Test Flow injection from LiveTripsClient.tsx." -ForegroundColor Green
Write-Host "Next: clear .next and restart dev server." -ForegroundColor Cyan
