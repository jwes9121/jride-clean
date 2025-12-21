# PATCH-LIVETRIPS-REMOVE-UNICODE-SEPARATORS-V2.ps1
# Fix mojibake permanently by forcing ASCII separators in LiveTrips UI files.
# No Unicode literals are used in this script (only codepoints / plain ASCII).

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path

$targets = @(
  "app\admin\livetrips\LiveTripsClient.tsx",
  "app\admin\livetrips\components\LiveTripsMap.tsx",
  "app\admin\livetrips\components\TripLifecycleActions.tsx",
  "app\admin\livetrips\components\TripWalletPanel.tsx",
  "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx"
) | ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ }

if ($targets.Count -eq 0) { Fail "No LiveTrips target files found in expected paths." }

# Unicode chars by codepoint (so we don't embed them as literals)
$EM_DASH  = [char]0x2014  # —
$BULLET   = [char]0x2022  # •
$ELLIPSIS = [char]0x2026  # …

# Mojibake sequences (ASCII-safe strings)
$MOJI_EMDASH  = "â€”"
$MOJI_BULLET  = "â€¢"
$MOJI_ELLIPS  = "â€¦"

foreach ($f in $targets) {
  $txt  = Get-Content -Raw -Encoding UTF8 $f
  $orig = $txt

  # Replace mojibake first
  $txt = $txt.Replace($MOJI_EMDASH, " - ")
  $txt = $txt.Replace($MOJI_BULLET, " | ")
  $txt = $txt.Replace($MOJI_ELLIPS, "...")

  # Replace real Unicode separators by codepoint
  $txt = $txt.Replace($EM_DASH,  " - ")
  $txt = $txt.Replace($BULLET,   " | ")
  $txt = $txt.Replace($ELLIPSIS, "...")

  # Normalize spacing around separators (optional, keeps it readable)
  $txt = $txt -replace '\s+\|\s+', ' | '
  $txt = $txt -replace '\s+-\s+',  ' - '

  if ($txt -ne $orig) {
    Set-Content -Path $f -Value $txt -Encoding UTF8
    Write-Host "OK: cleaned separators in $f" -ForegroundColor Green
  } else {
    Write-Host "SKIP: no changes in $f" -ForegroundColor DarkGray
  }
}

Write-Host "DONE. Now run: npm run dev" -ForegroundColor Cyan
