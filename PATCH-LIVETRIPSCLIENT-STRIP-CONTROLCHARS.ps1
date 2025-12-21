# PATCH-LIVETRIPSCLIENT-STRIP-CONTROLCHARS.ps1
# 1) Removes hidden control characters that can break SWC parsing
# 2) Normalizes line endings
# 3) Writes UTF-8 no BOM
# 4) Clears .next cache (recommended for stubborn parser failures)

$ErrorActionPreference="Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

# Read raw
$txt = Get-Content -Raw -Encoding UTF8 $f
$orig = $txt

# Remove BOM + zero-width
$txt = $txt -replace [char]0xFEFF, ""   # BOM
$txt = $txt -replace [char]0x200B, ""   # zero-width space
$txt = $txt -replace [char]0x200C, ""   # ZWNJ
$txt = $txt -replace [char]0x200D, ""   # ZWJ
$txt = $txt -replace [char]0x2060, ""   # word joiner

# Remove Unicode line/paragraph separators (these break parsers)
$txt = $txt -replace [char]0x2028, "`n" # LS
$txt = $txt -replace [char]0x2029, "`n" # PS

# Remove ASCII control chars except tab(0x09), LF(0x0A), CR(0x0D)
# This targets the weird invisible stuff SWC can choke on.
$sb = New-Object System.Text.StringBuilder
foreach ($ch in $txt.ToCharArray()) {
  $cp = [int][char]$ch
  $isOk =
    ($cp -eq 9) -or ($cp -eq 10) -or ($cp -eq 13) -or
    ($cp -ge 32 -and $cp -ne 127)
  if ($isOk) { [void]$sb.Append($ch) }
}
$txt = $sb.ToString()

# Normalize line endings to CRLF (optional but stabilizes diffs on Windows)
$txt = $txt -replace "`r?`n", "`r`n"

# Write UTF8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($f, $txt, $utf8NoBom)

# Clear Next build cache (important for stubborn build/parsing issues)
$nextDir = Join-Path $root ".next"
if (Test-Path $nextDir) {
  Remove-Item -Recurse -Force $nextDir
  Write-Host "OK: Removed .next cache." -ForegroundColor Yellow
}

if ($txt -eq $orig) {
  Write-Host "NOTE: No visible text changes, but file was rewritten cleanly." -ForegroundColor Yellow
} else {
  Write-Host "OK: Stripped hidden/control characters and rewrote file." -ForegroundColor Green
}

Write-Host "Next: npm run build" -ForegroundColor Cyan
