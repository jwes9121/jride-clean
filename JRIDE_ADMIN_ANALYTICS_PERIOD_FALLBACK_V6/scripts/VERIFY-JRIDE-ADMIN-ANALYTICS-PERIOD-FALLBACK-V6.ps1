$ErrorActionPreference = 'Stop'
Write-Host 'JRIDE ADMIN ANALYTICS PERIOD FALLBACK V6 - VERIFY'

$PagePath = 'app\admin\analytics\page.tsx'
if (!(Test-Path -LiteralPath $PagePath)) { throw "Missing file: $PagePath" }
$Content = Get-Content -LiteralPath $PagePath -Raw

$Markers = @(
  'tripApiPeriods',
  'setTripApiPeriods(tripsJson.periods || null)',
  'scope === "all" && tripApiPeriods',
  'applyPeriod(key, tripApiPeriods[key] || null)',
  '}, [scopedTrips, scope, tripApiPeriods]);'
)
foreach ($Marker in $Markers) {
  if (!$Content.Contains($Marker)) { throw "Missing marker: $Marker" }
}

$Status = git status --short
$Unexpected = $Status | Where-Object {
  $_ -match '^ M ' -and $_ -notmatch 'app/admin/analytics/page.tsx'
}
if ($Unexpected) {
  Write-Host $Status
  throw 'Unexpected tracked file changed in this patch'
}

Write-Host 'Verify passed.'
