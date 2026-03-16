# ============================================================
# CHECK-JRIDE_LIVETRIPSCLIENT_GUARDS_V2_PS5SAFE
# ============================================================
# Purpose:
#   Read-only structural guard for:
#   app/admin/livetrips/LiveTripsClient.tsx
#
# Checks:
#   1) top-level component return exists
#   2) no stray summary JSX markers remain
#   3) driverRows.map explicitly returns <tr
#   4) visibleTrips.map explicitly returns <tr
#   5) no stray </div> remains before callback return(
#   6) Trips / Drivers / Dispatch button fragments exist
#
# Safety:
#   - PowerShell 5 safe
#   - read-only
#   - loud abort on missing file
# ============================================================

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Fail([string]$Message) {
    throw $Message
}

# Script is inside:
#   repo\public\jride-patches\
# So repo root is two levels up from $scriptDir
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path

$target = Join-Path $repoRoot "app\admin\livetrips\LiveTripsClient.tsx"

if (-not (Test-Path -LiteralPath $target)) {
    Fail "ABORT: target file not found: $target"
}

$content = Get-Content -LiteralPath $target -Raw -Encoding UTF8

$failures = New-Object 'System.Collections.Generic.List[string]'

# 1. Top-level return must exist after component declaration
if ($content -notmatch '(?ms)export default function LiveTripsClient\(\)\s*\{.*?^\s*return \(') {
    [void]$failures.Add("Top-level component return not found")
}

# 2. No stray summary JSX markers
if ($content -match 'Eligible:\s*\{drivers\.filter' -or
    $content -match 'Stale:\s*\{drivers\.filter' -or
    $content -match 'Active Trips:\s*\{allTrips\.filter' -or
    $content -match 'Waiting Trips:\s*\{allTrips\.filter') {
    [void]$failures.Add("Stray summary JSX block markers still present")
}

# 3. driverRows.map must explicitly return <tr
if ($content -notmatch '(?ms)driverRows\.map\(\(row\)\s*=>\s*\{.*?return\s*\(\s*<tr') {
    [void]$failures.Add("driverRows.map does not explicitly return <tr")
}

# 4. visibleTrips.map must explicitly return <tr
if ($content -notmatch '(?ms)visibleTrips\.map\(\(t,\s*idx\)\s*=>\s*\{.*?return\s*\(\s*<tr') {
    [void]$failures.Add("visibleTrips.map does not explicitly return <tr")
}

# 5. No stray standalone </div> before callback return(
if ($content -match '(?ms)visibleTrips\.map\(\(t,\s*idx\)\s*=>\s*\{.*?</div>\s*return\s*\(') {
    [void]$failures.Add("visibleTrips.map still contains stray </div> before return(")
}
if ($content -match '(?ms)driverRows\.map\(\(row\)\s*=>\s*\{.*?</div>\s*return\s*\(') {
    [void]$failures.Add("driverRows.map still contains stray </div> before return(")
}
if ($content -match '(?ms)drivers\.map\(\(d,\s*idx\)\s*=>\s*\{.*?</div>\s*return\s*\(') {
    [void]$failures.Add("manual driver select callback still contains stray </div> before return(")
}

# 6. Required top button fragments
foreach ($needle in @('Trips <span', 'Drivers <span', 'Dispatch <span')) {
    if (-not $content.Contains($needle)) {
        [void]$failures.Add("Missing expected UI button fragment: $needle")
    }
}

# 7. Manual driver select callback should return <option
if ($content -notmatch '(?ms)drivers\.map\(\(d,\s*idx\)\s*=>\s*\{.*?return\s*\(\s*<option') {
    [void]$failures.Add("manual driver select callback does not explicitly return <option")
}

# 8. ASCII-only check
$nonAscii = [regex]::Match($content, '[^\u0000-\u007F]')
if ($nonAscii.Success) {
    $code = [int][char]$nonAscii.Value
    [void]$failures.Add("Non-ASCII character detected: U+" + ('{0:X4}' -f $code))
}

Write-Host ""
Write-Host "== VERIFICATION ==" -ForegroundColor Cyan
Write-Host ("TARGET: " + $target) -ForegroundColor White

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "GUARD CHECK FAILED" -ForegroundColor Red
    foreach ($f in $failures) {
        Write-Host (" - " + $f) -ForegroundColor Red
    }
    exit 1
}

Write-Host "PASS: top-level return exists" -ForegroundColor Green
Write-Host "PASS: no stray summary JSX markers remain" -ForegroundColor Green
Write-Host "PASS: driverRows.map explicitly returns <tr" -ForegroundColor Green
Write-Host "PASS: visibleTrips.map explicitly returns <tr" -ForegroundColor Green
Write-Host "PASS: no stray </div> before callback return(" -ForegroundColor Green
Write-Host "PASS: Trips / Drivers / Dispatch button fragments exist" -ForegroundColor Green
Write-Host "PASS: manual driver select callback returns <option" -ForegroundColor Green
Write-Host "PASS: ASCII-only" -ForegroundColor Green

Write-Host ""
Write-Host "GUARD CHECK PASSED" -ForegroundColor Green