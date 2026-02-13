# FIX-LIVETRIPS-CLIENT-REFRESH.ps1
# Run from repo root: C:\Users\jwes9\Desktop\jride-clean-fresh
$ErrorActionPreference = "Stop"

function Backup-File($path) {
  if (-not (Test-Path $path)) { throw "Missing file: $path" }
  $ts = Get-Date -Format "yyyyMMdd-HHmmss"
  $bak = "$path.bak-$ts"
  Copy-Item $path $bak -Force
  Write-Host "Backup: $bak" -ForegroundColor DarkGray
}

function Read-Text($path) { Get-Content -Raw -Encoding UTF8 $path }
function Write-Text($path, $text) {
  [IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

function Replace-Once([string]$s, [string]$pattern, [string]$replacement, [string]$errIfMissing) {
  $rx = [regex]::new($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if (-not $rx.IsMatch($s)) { throw $errIfMissing }
  return $rx.Replace($s, $replacement, 1)
}

function Try-Replace-Once([string]$s, [string]$pattern, [string]$replacement) {
  $rx = [regex]::new($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if (-not $rx.IsMatch($s)) { return $s }
  return $rx.Replace($s, $replacement, 1)
}

function Find-SetterName([string]$text, [string]$suffix) {
  # Finds first call like setSomethingTrips( ... ) or setTrips( ... )
  $rx = [regex]::new("(?m)\b(set[A-Za-z0-9_]*$suffix)\s*\(", [System.Text.RegularExpressions.RegexOptions]::None)
  $m = $rx.Match($text)
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}

$root = Get-Location
$clientPath = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"

Backup-File $clientPath
$c = Read-Text $clientPath

# --- 0) If file had illegal top-level await refreshPageData(), neutralize it ---
$c = Try-Replace-Once $c `
  '(?s)\btry\s*\{\s*await\s+refreshPageData\(\)\s*;\s*\}\s*catch\s*\(\s*e\s*\)\s*\{\s*console\.warn\(\s*"refreshPageData failed"\s*,\s*e\s*\)\s*;\s*\}' `
  'refreshPageData().catch((e) => console.warn("refreshPageData failed", e));'

# --- 1) Detect setter names dynamically (even if you renamed them) ---
$setTrips      = Find-SetterName $c "Trips"
$setDrivers    = Find-SetterName $c "Drivers"
$setCounts     = Find-SetterName $c "Counts"
$setKpi        = Find-SetterName $c "Kpi"
$setLastAction = Find-SetterName $c "LastAction"

if (-not $setTrips) {
  Write-Host "WARN: Could not detect a trips setter (set*Trips). refreshPageData will still fetch, but may not update trips." -ForegroundColor Yellow
} else {
  Write-Host "Detected trips setter: $setTrips" -ForegroundColor DarkGray
}

# --- 2) Insert refreshPageData + event listener INSIDE component ---
if ($c -notmatch '\bconst\s+refreshPageData\s*=\s*async\b' -and $c -notmatch '\bfunction\s+refreshPageData\s*\(') {

  $fn = @()
  $fn += '  // ------------------------------------------------------------'
  $fn += '  // HARD refresh page-data so left list + right panel stay in sync'
  $fn += '  // ------------------------------------------------------------'
  $fn += '  const refreshPageData = async () => {'
  $fn += '    try {'
  $fn += '      const res = await fetch("/api/admin/livetrips/page-data?debug=1", { cache: "no-store" as any });'
  $fn += '      const json: any = await res.json().catch(() => ({}));'
  if ($setTrips)      { $fn += "      if (json && json.trips) { $setTrips(json.trips); }" }
  if ($setDrivers)    { $fn += "      if (json && (json.drivers || json.driverLocations)) { $setDrivers(json.drivers || json.driverLocations); }" }
  if ($setCounts)     { $fn += "      if (json && json.counts) { $setCounts(json.counts); }" }
  if ($setKpi)        { $fn += "      if (json && json.kpi) { $setKpi(json.kpi); }" }
  if ($setLastAction) { $fn += "      $setLastAction(`"OK: refreshed page-data`");" }
  $fn += '    } catch (e: any) {'
  if ($setLastAction) {
    $fn += "      $setLastAction(String(e?.message || e));"
  } else {
    $fn += '      console.warn("refreshPageData failed", e);'
  }
  $fn += '    }'
  $fn += '  };'
  $fn += ''
  $fn += '  // Map/right-panel can request a refresh to keep UI consistent'
  $fn += '  useEffect(() => {'
  $fn += '    const handler = () => { refreshPageData().catch((e) => console.warn("refreshPageData failed", e)); };'
  $fn += '    window.addEventListener("livetrips:refresh", handler as any);'
  $fn += '    return () => window.removeEventListener("livetrips:refresh", handler as any);'
  $fn += '  }, []);'
  $fn += ''

  $block = ($fn -join "`r`n")

  # Preferred anchor: insert before first useEffect( inside component
  if ($c -match '(?s)\r?\n\s*useEffect\s*\(') {
    $c = Replace-Once $c `
      '(?s)(\r?\n\s*)useEffect\s*\(' `
      "`r`n$block`r`n`$1useEffect(" `
      "Could not insert refreshPageData before useEffect in LiveTripsClient.tsx."
  }
  elseif ($c -match '(?s)\r?\n\s*return\s*\(') {
    # Fallback anchor: insert before return (
    $c = Replace-Once $c `
      '(?s)(\r?\n\s*)return\s*\(' `
      "`r`n$block`r`n`$1return(" `
      "Could not insert refreshPageData before return(...) in LiveTripsClient.tsx."
  }
  else {
    throw "Could not find an anchor (useEffect or return) to insert refreshPageData in LiveTripsClient.tsx."
  }

  Write-Host "Inserted refreshPageData() + livetrips:refresh listener in LiveTripsClient.tsx" -ForegroundColor Green
} else {
  Write-Host "refreshPageData already exists in LiveTripsClient.tsx; skipping insertion." -ForegroundColor Yellow
}

Write-Text $clientPath $c
Write-Host "Patched: $clientPath" -ForegroundColor Green

Write-Host ""
Write-Host "NEXT:" -ForegroundColor Cyan
Write-Host "  1) Stop dev server (Ctrl+C)" -ForegroundColor Cyan
Write-Host "  2) npm run dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "Test:" -ForegroundColor Cyan
Write-Host "  - Click action on right panel => it should dispatch livetrips:refresh and left list should sync." -ForegroundColor Cyan
