# FIND-JRIDE_RIDE_CREATE_ROUTE_V3.ps1
# Robust scanner to find ride booking creation routes (NO regex).
# ASCII only. Read-only. Works on older PowerShell.

$ErrorActionPreference = "Stop"

$root = Get-Location
$apiRoot = Join-Path $root "app\api"

if (!(Test-Path $apiRoot)) {
  Write-Host "ERROR: app/api not found. Run from repo root."
  exit 1
}

# Plain substring patterns (case-insensitive)
$patterns = @(
  "export async function post",
  "export function post",
  "insert",
  "upsert",
  ".from(",
  "rides",
  "trips",
  "bookings",
  "passenger_id",
  "driver_id",
  "pickup",
  "dropoff",
  "fare",
  "amount",
  "status",
  "create"
)

Write-Host "Scanning route.ts under: $apiRoot"
Write-Host ""

$results = @()

Get-ChildItem -Path $apiRoot -Recurse -Filter "route.ts" | ForEach-Object {
  $path = $_.FullName

  $content = ""
  try {
    $content = (Get-Content -LiteralPath $path -ErrorAction Stop) -join "`n"
  } catch {
    return
  }

  $lc = $content.ToLowerInvariant()

  $hits = @()
  foreach ($p in $patterns) {
    if ($lc.Contains($p)) { $hits += $p }
  }

  $score = $hits.Count
  if ($score -ge 5) {
    $results += [pscustomobject]@{
      Score = $score
      Path  = $path
      Hits  = ($hits -join ", ")
    }
  }
}

if ($results.Count -eq 0) {
  Write-Host "No strong matches found."
  Write-Host "Tip: Lower the threshold (score) if needed."
  exit 0
}

$results |
  Sort-Object Score -Descending |
  Select-Object -First 40 |
  ForEach-Object {
    Write-Host "----------------------------------------"
    Write-Host ("SCORE: {0}" -f $_.Score)
    Write-Host $_.Path
    Write-Host ("Matched: {0}" -f $_.Hits)
  }

Write-Host ""
Write-Host "Done."
Write-Host "The real booking creator usually includes POST + passenger_id + pickup/dropoff + insert/upsert."
