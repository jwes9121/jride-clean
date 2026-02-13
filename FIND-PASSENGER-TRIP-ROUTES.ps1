# FIND-PASSENGER-TRIP-ROUTES.ps1
# StrictMode-safe: no $_, no pipeline scriptblocks.

$ErrorActionPreference = "Stop"

$root = Join-Path (Get-Location) "app"
Write-Host "Scanning under: $root"
Write-Host ""

# 1) Directory hits
$dirs = Get-ChildItem -Path $root -Recurse -Directory -ErrorAction SilentlyContinue
$hits = @()
foreach ($d in $dirs) {
  $p = $d.FullName
  if ($p -match '\\app\\ride($|\\)' -or $p -match '\\app\\passenger\\trip($|\\)') {
    $hits += $p
  }
}

Write-Host "Matching directories:"
if ($hits.Count -eq 0) {
  Write-Host "  (none found)"
} else {
  $hits | Sort-Object -Unique | ForEach-Object { "  " + $_ }
}

Write-Host ""
Write-Host "Ride-related page.tsx files:"
# 2) Ride-related page.tsx files
$files = Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue
$ridePages = @()
foreach ($f in $files) {
  if ($f.Name -eq "page.tsx") {
    if ($f.FullName -match '\\ride\\') {
      $ridePages += $f.FullName
    }
  }
}

if ($ridePages.Count -eq 0) {
  Write-Host "  (none found)"
} else {
  $ridePages | Sort-Object -Unique | ForEach-Object { "  " + $_ }
}

Write-Host ""
Write-Host "Done."
