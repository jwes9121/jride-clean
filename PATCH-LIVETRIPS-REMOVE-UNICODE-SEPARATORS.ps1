# PATCH-LIVETRIPS-REMOVE-UNICODE-SEPARATORS.ps1
# Permanently prevents mojibake by removing Unicode separators from LiveTrips UI labels.
# Replaces: — • … and mojibake - â€¢ â€¦ with ASCII: - | ...
# No layout / Mapbox changes.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path

$files = @(
  "app\admin\livetrips\LiveTripsClient.tsx",
  "app\admin\livetrips\components\LiveTripsMap.tsx",
  "app\admin\livetrips\components\TripLifecycleActions.tsx",
  "app\admin\livetrips\components\TripWalletPanel.tsx",
  "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx"
) | ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ }

if ($files.Count -eq 0) { Fail "No target LiveTrips files found at expected paths." }

# Replacement map (do mojibake forms first)
$repls = @(
  @{ from = "-"; to = " - " },
  @{ from = "â€¢"; to = " | " },
  @{ from = "â€¦"; to = "..." },
  @{ from = "—";   to = " - " },
  @{ from = "•";   to = " | " },
  @{ from = "…";   to = "..." }
)

foreach ($f in $files) {
  $txt = Get-Content -Raw -Encoding UTF8 $f
  $orig = $txt

  foreach ($r in $repls) {
    $txt = $txt.Replace($r.from, $r.to)
  }

  # Optional: collapse duplicate spaces around separators
  $txt = $txt -replace '\s+\|\s+', ' | '
  $txt = $txt -replace '\s+-\s+',  ' - '

  if ($txt -ne $orig) {
    Set-Content -Path $f -Value $txt -Encoding UTF8
    Write-Host "OK: cleaned unicode separators in $f" -ForegroundColor Green
  } else {
    Write-Host "SKIP: no unicode separators found in $f" -ForegroundColor DarkGray
  }
}

# Prevent npm.ps1 StrictMode crash in the same session
Set-StrictMode -Off
Write-Host "DONE. StrictMode OFF for this session." -ForegroundColor Cyan
