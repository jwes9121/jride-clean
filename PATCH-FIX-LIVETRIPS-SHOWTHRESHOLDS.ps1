# PATCH-FIX-LIVETRIPS-SHOWTHRESHOLDS.ps1
# Forces showThresholds into a valid template literal right before the JSX return().
# Fixes: Unexpected token 'div'. Expected jsx identifier (caused by malformed preceding statement)

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$file = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $file)) { Fail "Missing file: $file" }

$lines = Get-Content -Path $file -Encoding UTF8
$origCount = $lines.Count

$found = $false
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^\s*const\s+showThresholds\s*=') {
    $indent = ""
    if ($lines[$i] -match '^(\s*)const\s+showThresholds') { $indent = $Matches[1] }

    # Replace whole line with a valid template literal (ASCII only)
    $lines[$i] = $indent + 'const showThresholds = `Stuck watcher thresholds: on_the_way ---- ${STUCK_THRESHOLDS_MIN.on_the_way} min, on_trip ---- ${STUCK_THRESHOLDS_MIN.on_trip} min`;'
    $found = $true
    break
  }
}

if (-not $found) {
  Fail "Could not find 'const showThresholds =' in LiveTripsClient.tsx"
}

# Write UTF8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($file, $lines, $utf8NoBom)

Write-Host "OK: showThresholds line fixed." -ForegroundColor Green
Write-Host "Next: npm run build" -ForegroundColor Cyan
