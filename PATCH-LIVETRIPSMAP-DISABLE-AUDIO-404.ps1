# PATCH-LIVETRIPSMAP-DISABLE-AUDIO-404.ps1
# Removes the audio HEAD check + <audio src="/audio/jride_audio.mp3"> to stop console 404 spam.
# Does NOT touch Mapbox layout/styling.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path

$mapPath = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path $mapPath)) {
  # fallback (some repos keep it under /map/)
  $alt = Join-Path $root "app\admin\livetrips\map\LiveTripsMap.tsx"
  if (Test-Path $alt) { $mapPath = $alt } else { Fail "LiveTripsMap.tsx not found in components/ or map/." }
}

Write-Host "Patching: $mapPath" -ForegroundColor Cyan
$txt = Get-Content -Raw -Encoding UTF8 $mapPath
$orig = $txt

# 1) Remove the HEAD-check useEffect block (any block that fetches /audio/jride_audio.mp3 with method HEAD)
$txt = [regex]::Replace(
  $txt,
  '(?s)\r?\n\s*useEffect\(\(\)\s*=>\s*\{\s*[\s\S]{0,4000}?fetch\(\s*["' + "'" + '"]\/audio\/jride_audio\.mp3["' + "'" + '"]\s*,\s*\{\s*method\s*:\s*["' + "'" + '"]HEAD["' + "'" + '"][\s\S]{0,4000}?\}\s*,\s*\[\s*\]\s*\)\s*;\s*',
  "`r`n",
  1
)

# 2) Remove any audioSrc state if it was added
$txt = [regex]::Replace(
  $txt,
  '(?m)^\s*const\s+\[audioSrc,\s*setAudioSrc\]\s*=\s*useState<[^>]*>\([^)]*\);\s*\r?\n',
  '',
  1
)

# 3) Remove/replace any <audio ... src="/audio/jride_audio.mp3" .../>
$txt = [regex]::Replace(
  $txt,
  '(?s)\r?\n[ \t]*<audio[^>]*src="\/audio\/jride_audio\.mp3"[^>]*/>\s*',
  "`r`n",
  0
)

# 4) Remove/replace guarded audio rendering blocks that still reference audioSrc
$txt = [regex]::Replace(
  $txt,
  '(?s)\{audioSrc\s*\?\s*\(\s*<audio[^>]*>\s*\)\s*:\s*null\s*\}',
  '{null}',
  0
)

# 5) If alertAudioRef is only used for audio, we leave it; harmless. (No layout changes.)

if ($txt -eq $orig) {
  Write-Host "NOTE: No /audio/jride_audio.mp3 HEAD/audio blocks found to patch. (File may differ.)" -ForegroundColor Yellow
} else {
  Set-Content -Path $mapPath -Value $txt -Encoding UTF8
  Write-Host "OK: Audio HEAD + audio element removed. Console 404 should be gone." -ForegroundColor Green
}

# IMPORTANT: turn StrictMode off so npm.ps1 won't crash in this same shell
Set-StrictMode -Off
Write-Host "StrictMode turned OFF for this session (prevents npm.ps1 error)." -ForegroundColor DarkGray
