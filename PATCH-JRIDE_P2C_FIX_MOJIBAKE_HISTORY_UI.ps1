# PATCH-JRIDE_P2C_FIX_MOJIBAKE_HISTORY_UI.ps1
# UI ONLY – fixes mojibake in passenger history receipt
# No backend changes, no Mapbox, no logic changes

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$root = (Get-Location).Path
$target = Join-Path $root "app\history\page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $target "$target.bak.$stamp" -Force
Ok "Backup created"

$txt = Get-Content $target -Raw

if ($txt -notmatch "function normalizeText") {
  $insert = @'
function normalizeText(v: any): string {
  if (typeof v !== "string") return v ?? "—";
  return v
    .replace(/â‚±/g, "₱")
    .replace(/-/g, "—")
    .replace(/-/g, "–")
    .replace(/·/g, "·")
    .replace(/'|'/g, "'")
    .replace(/"|â€ /g, '"')
    .replace(//g, "")
    .trim();
}

'@

  $txt = $txt -replace '(function km\([\s\S]*?\}\n)', "`$1`n$insert"
  Ok "Inserted normalizeText() helper"
}

# Apply normalizeText to visible fields
$replacements = @{
  '{t.pickup}'                = '{normalizeText(t.pickup)}'
  '{t.dropoff}'               = '{normalizeText(t.dropoff)}'
  '{selectedTrip.pickup}'     = '{normalizeText(selectedTrip.pickup)}'
  '{selectedTrip.dropoff}'    = '{normalizeText(selectedTrip.dropoff)}'
  '{selectedTrip.payment}'    = '{normalizeText(selectedTrip.payment)}'
}

foreach ($k in $replacements.Keys) {
  $txt = $txt -replace [regex]::Escape($k), $replacements[$k]
}

# Fare & distance labels
$txt = $txt `
  -replace 'peso\(selectedTrip\.farePhp\)', 'normalizeText(peso(selectedTrip.farePhp))' `
  -replace 'km\(selectedTrip\.distanceKm\)', 'normalizeText(km(selectedTrip.distanceKm))'

[System.IO.File]::WriteAllText(
  $target,
  $txt,
  New-Object System.Text.UTF8Encoding($false)
)

Ok "Mojibake normalization applied"
Ok "Done"
