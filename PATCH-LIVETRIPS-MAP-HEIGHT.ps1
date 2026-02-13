# PATCH-LIVETRIPS-MAP-HEIGHT.ps1
# Robust: finds <LiveTripsMap ...> and adds height to its nearest wrapping <div className=...>

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$lines = Get-Content -LiteralPath $f -Encoding UTF8

# 1) Locate the line index where <LiveTripsMap appears
$mapIdx = -1
for ($i=0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '<\s*LiveTripsMap\b') { $mapIdx = $i; break }
}
if ($mapIdx -lt 0) { Fail "Could not find <LiveTripsMap ...> in LiveTripsClient.tsx" }

# 2) Walk upwards to find the nearest preceding <div ... className=...>
$wrapIdx = -1
for ($j=$mapIdx; $j -ge 0; $j--) {
  if ($lines[$j] -match '<div\b' -and $lines[$j] -match 'className\s*=') {
    $wrapIdx = $j
    break
  }
}
if ($wrapIdx -lt 0) { Fail "Found <LiveTripsMap> but could not find a wrapping <div ... className=...> above it." }

$target = $lines[$wrapIdx]

# 3) If height already present, do nothing
if ($target -match 'min-h-\[' -or $target -match '\bh-\[' -or $target -match '\bmin-h-\d' -or $target -match '\bh-\d') {
  Write-Host "Map wrapper already has height/min-height; no change needed." -ForegroundColor Yellow
  exit 0
}

# 4) Append classes inside className="" or className=''
# Handles:
# className="..."
# className='...'
# className={"..."} or className={'...'}
$added = " min-h-[520px] h-[520px]"

$patched = $false

# a) className="..."
if ($target -match 'className\s*=\s*"([^"]*)"') {
  $cls = $Matches[1]
  $newCls = ($cls + $added).Trim()
  $lines[$wrapIdx] = ($target -replace 'className\s*=\s*"[^"]*"', ('className="' + $newCls + '"'))
  $patched = $true
}
# b) className='...'
elseif ($target -match "className\s*=\s*'([^']*)'") {
  $cls = $Matches[1]
  $newCls = ($cls + $added).Trim()
  $lines[$wrapIdx] = ($target -replace "className\s*=\s*'[^']*'", ("className='" + $newCls + "'"))
  $patched = $true
}
# c) className={"..."} / {'...'}
elseif ($target -match 'className\s*=\s*\{\s*"([^"]*)"\s*\}') {
  $cls = $Matches[1]
  $newCls = ($cls + $added).Trim()
  $lines[$wrapIdx] = ($target -replace 'className\s*=\s*\{\s*"[^"]*"\s*\}', ('className={"' + $newCls + '"}'))
  $patched = $true
}
elseif ($target -match "className\s*=\s*\{\s*'([^']*)'\s*\}") {
  $cls = $Matches[1]
  $newCls = ($cls + $added).Trim()
  $lines[$wrapIdx] = ($target -replace "className\s*=\s*\{\s*'[^']*'\s*\}", ("className={'" + $newCls + "'}"))
  $patched = $true
}

if (-not $patched) {
  Fail "Found wrapper line but couldn't patch className format. Wrapper line was: $target"
}

# 5) Write back
Set-Content -LiteralPath $f -Value $lines -Encoding UTF8

Write-Host "PATCHED map wrapper height at line $($wrapIdx+1) in: $f" -ForegroundColor Green
Write-Host "Wrapper line now: $($lines[$wrapIdx])" -ForegroundColor DarkGray
