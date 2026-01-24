# FIND-JRIDE_EMERGENCY_ASSIGN_TOUCHPOINTS_V1.ps1
# Finds where bookings are created and where drivers are filtered by town/zone/status.
$ErrorActionPreference = "Stop"

$root = Get-Location
$paths = @(
  (Join-Path $root "app"),
  (Join-Path $root "src")
) | Where-Object { Test-Path $_ }

$needles = @(
  "is_emergency",
  "emergency",
  "passenger/book",
  "bookings",
  "auto-assign",
  "dispatch/assign",
  "driver_locations",
  "drivers",
  "town",
  "zone",
  "available",
  "online",
  ".from(""bookings"")",
  ".from('bookings')",
  ".eq(""town""",
  ".eq('town'",
  ".eq(""zone_id""",
  ".eq('zone_id'",
  "radius",
  "pickup_distance"
)

Write-Host "Scanning code under: $($paths -join ', ')" -ForegroundColor Cyan

$results = @()

foreach ($p in $paths) {
  Get-ChildItem -Path $p -Recurse -File -Include *.ts,*.tsx,*.js,*.jsx 2>$null |
    ForEach-Object {
      $file = $_.FullName
      $txt = ""
      try { $txt = Get-Content -LiteralPath $file -Raw -ErrorAction Stop } catch { return }
      $hit = @()
      foreach ($n in $needles) {
        if ($txt -like ("*" + $n + "*")) { $hit += $n }
      }
      if ($hit.Count -gt 0) {
        $results += [pscustomobject]@{
          File = $file
          Hits = ($hit | Select-Object -Unique) -join ", "
          Score = ($hit | Select-Object -Unique).Count
        }
      }
    }
}

$results |
  Sort-Object Score -Descending |
  Select-Object -First 40 |
  ForEach-Object {
    Write-Host "----------------------------------------"
    Write-Host ("SCORE: " + $_.Score)
    Write-Host $_.File
    Write-Host ("Matched: " + $_.Hits)
  }

Write-Host "Done." -ForegroundColor Green
