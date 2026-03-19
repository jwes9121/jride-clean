# FIX-JRIDE_PASSENGER_BADGE_SCOPE_V1_PS5SAFE.ps1
param(
  [Parameter(Mandatory = $true)]
  [string]$WebRoot
)

$ErrorActionPreference = "Stop"

$target = Join-Path $WebRoot "app\ride\page.tsx"

if (-not (Test-Path -LiteralPath $target)) {
  throw "Target not found: $target"
}

$raw = [System.IO.File]::ReadAllText($target, [System.Text.Encoding]::UTF8)
$original = $raw

$bad = '{hasOffer ? "CONFIRMED" : "ESTIMATE"}'
$good = '{((liveBooking as any)?.proposed_fare != null) ? "CONFIRMED" : "ESTIMATE"}'

if ($raw.Contains($bad)) {
  $raw = $raw.Replace($bad, $good)
  Write-Host "[OK] Replaced out-of-scope hasOffer badge expression." -ForegroundColor Green
} else {
  Write-Host "[WARN] Broken hasOffer badge expression not found. No change made." -ForegroundColor Yellow
}

if ($raw -eq $original) {
  Write-Host "[INFO] File unchanged."
  exit 0
}

$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $raw, $enc)

Write-Host "[DONE] Wrote fixed page.tsx with UTF-8 no BOM." -ForegroundColor Cyan