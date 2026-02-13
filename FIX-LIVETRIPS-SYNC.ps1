# FIX-LIVETRIPS-SYNC.ps1
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
  # ensure LF/CRLF stays acceptable
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

# --- Paths ---
$root = Get-Location
$clientPath = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
$mapPath    = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"

Backup-File $clientPath
Backup-File $mapPath

# ============================================================
# A) Patch LiveTripsClient.tsx (compile + refresh sync)
# ============================================================
$c = Read-Text $clientPath

# 1) Remove top-level illegal "await refreshPageData()" (if it exists)
#    Convert any block like:
#      try { await refreshPageData(); } catch (e) { ... }
#    into:
#      refreshPageData().catch((e) => console.warn(..., e));
$c = Try-Replace-Once $c `
  '(?s)\btry\s*\{\s*await\s+refreshPageData\(\)\s*;\s*\}\s*catch\s*\(\s*e\s*\)\s*\{\s*console\.warn\(\s*"refreshPageData failed"\s*,\s*e\s*\)\s*;\s*\}' `
  'refreshPageData().catch((e) => console.warn("refreshPageData failed", e));'

# 2) Fix "toStatus is defined multiple times" inside updateTripStatus:
#    If there are 2 "const toStatus =" lines, keep the first, rename the later one.
#    We rename the later one to toStatus2 and also update its usage for applyTripStatusToTrips if present.
#    (This avoids TS compile error immediately.)
# Rename the SECOND occurrence only by targeting the "Robust UI update" comment area if present,
# otherwise fallback to renaming any later duplicate near the bottom.
$c = Try-Replace-Once $c `
  '(?s)(//\s*Robust UI update.*?\bconst\s+apiCode\s*=.*?\bconst\s+apiId\s*=.*?\b)const\s+toStatus\s*=' `
  '$1const toStatus2 ='

# If applyTripStatusToTrips is using "toStatus" in that robust block, try to switch it to toStatus2
$c = Try-Replace-Once $c `
  '(?s)(applyTripStatusToTrips\([^;]*?,\s*apiCode\s*,\s*apiId\s*,\s*)toStatus(\s*\))' `
  '$1toStatus2$2'

# 3) Ensure refreshPageData() exists INSIDE the main component and is in scope.
#    We'll insert it just BEFORE the first usage of refreshPageData().catch(
#    It will auto-detect useState setters: setTrips, setDrivers, setCounts, setKpi, setLastAction if present.
if ($c -notmatch '\bfunction\s+refreshPageData\s*\(' -and $c -notmatch '\bconst\s+refreshPageData\s*=\s*async\b') {

  # detect setter names if present
  $setTrips     = $null
  $setDrivers   = $null
  $setCounts    = $null
  $setKpi       = $null
  $setLastAction= $null

  if ($c -match '(?m)\[\s*trips\s*,\s*(setTrips)\s*\]\s*=\s*useState') { $setTrips = $Matches[1] }
  if ($c -match '(?m)\[\s*drivers\s*,\s*(setDrivers)\s*\]\s*=\s*useState') { $setDrivers = $Matches[1] }
  if ($c -match '(?m)\[\s*counts\s*,\s*(setCounts)\s*\]\s*=\s*useState') { $setCounts = $Matches[1] }
  if ($c -match '(?m)\[\s*kpi\s*,\s*(setKpi)\s*\]\s*=\s*useState') { $setKpi = $Matches[1] }
  if ($c -match '(?m)\[\s*lastAction\s*,\s*(setLastAction)\s*\]\s*=\s*useState') { $setLastAction = $Matches[1] }

  if (-not $setTrips) {
    Write-Host "WARN: Could not detect setTrips; refreshPageData will be a safe no-op update." -ForegroundColor Yellow
  }

  $fn = @()
  $fn += '  // ------------------------------------------------------------'
  $fn += '  // HARD refresh page-data so left list + right map stay in sync'
  $fn += '  // ------------------------------------------------------------'
  $fn += '  const refreshPageData = async () => {'
  $fn += '    try {'
  $fn += '      const res = await fetch("/api/admin/livetrips/page-data?debug=1", { cache: "no-store" as any });'
  $fn += '      const json: any = await res.json().catch(() => ({}));'
  if ($setTrips)   { $fn += "      if (json && json.trips) { $setTrips(json.trips); }" }
  if ($setDrivers) { $fn += "      if (json && (json.drivers || json.driverLocations)) { $setDrivers(json.drivers || json.driverLocations); }" }
  if ($setCounts)  { $fn += "      if (json && json.counts) { $setCounts(json.counts); }" }
  if ($setKpi)     { $fn += "      if (json && json.kpi) { $setKpi(json.kpi); }" }
  if ($setLastAction) {
    $fn += "      $setLastAction(`"OK: refreshed page-data`");"
  }
  $fn += '    } catch (e: any) {'
  if ($setLastAction) {
    $fn += "      $setLastAction(String(e?.message || e));"
  } else {
    $fn += '      console.warn("refreshPageData failed", e);'
  }
  $fn += '    }'
  $fn += '  };'
  $fn += ''

  $insert = ($fn -join "`r`n")

  # Insert before first "refreshPageData().catch(" occurrence (your file shows multiple lines like that)
  $c = Replace-Once $c `
    '(?s)(\r?\n\s*)refreshPageData\(\)\.catch' `
    "`r`n$insert`r`n`$1refreshPageData().catch" `
    "Could not find any refreshPageData().catch call to anchor insertion in LiveTripsClient.tsx."
  Write-Host "Inserted refreshPageData() inside LiveTripsClient component." -ForegroundColor Green
}

# 4) Add global event listener in LiveTripsClient so the map panel can request refresh.
#    This is the cleanest way to keep left/right synced without rewriting your data flow.
if ($c -notmatch 'livetrips:refresh') {
  $listener = @()
  $listener += '  // Listen for refresh requests from the map/right-panel'
  $listener += '  useEffect(() => {'
  $listener += '    const handler = () => { refreshPageData().catch((e) => console.warn("refreshPageData failed", e)); };'
  $listener += '    window.addEventListener("livetrips:refresh", handler as any);'
  $listener += '    return () => window.removeEventListener("livetrips:refresh", handler as any);'
  $listener += '  }, []);'
  $listener += ''

  $listenerBlock = ($listener -join "`r`n")

  # Insert after first useEffect import usage section: place after first existing useEffect(() => { ... }, ...)
  $c = Replace-Once $c `
    '(?s)(\buseEffect\s*\(\s*\(\s*\)\s*=>\s*\{.*?\}\s*,\s*\[.*?\]\s*\)\s*;\s*)' `
    '$1' + "`r`n" + $listenerBlock `
    "Could not find a useEffect(...) block to insert the livetrips:refresh listener in LiveTripsClient.tsx."
  Write-Host "Added livetrips:refresh listener in LiveTripsClient.tsx" -ForegroundColor Green
}

Write-Text $clientPath $c
Write-Host "Patched: $clientPath" -ForegroundColor Green

# ============================================================
# B) Patch LiveTripsMap.tsx (selectedTrip + restore panel)
# ============================================================
$m = Read-Text $mapPath

# 1) Repair selectedTrip useMemo so it matches tripKey(...) === selectedTripId
#    Replace the whole selectedTrip memo body safely.
$m = Replace-Once $m `
  '(?s)\bconst\s+selectedTrip\s*=\s*useMemo\s*\(\s*\(\s*\)\s*=>\s*\{.*?\}\s*,\s*\[.*?\]\s*\)\s*;' `
  @'
const selectedTrip = useMemo(() => {
  const sid = String(selectedTripId || "").trim();
  if (!sid) return null;
  const list: any[] = (trips as any[]) || [];
  // IMPORTANT: use the same tripKey() used across the map, so selection stays consistent
  for (let i = 0; i < list.length; i++) {
    const t: any = list[i];
    try {
      if (tripKey(t, i) === sid) return t;
    } catch {}
  }
  return null;
}, [trips, selectedTripId]);
'@ `
  "Could not find 'const selectedTrip = useMemo(...)' block in LiveTripsMap.tsx to replace. (It may be broken/partial.)"

Write-Host "Fixed selectedTrip resolution in LiveTripsMap.tsx" -ForegroundColor Green

# 2) Ensure DispatchActionPanel is rendered and ALWAYS visible with scroll
#    We replace the FIRST <DispatchActionPanel .../> usage with a wrapper that is absolute + scrollable.
if ($m -match '<DispatchActionPanel\b') {
  # Add onActionCompleted that triggers global refresh
  # Also ensure it receives selectedTrip
  $m = Try-Replace-Once $m `
    '(?s)<DispatchActionPanel\s+([^>]*?)\bselectedTrip\s*=\s*\{selectedTrip\}([^>]*?)\/>' `
    '<div style={{ position: "absolute", right: 12, top: 12, zIndex: 60, pointerEvents: "auto", maxHeight: "calc(100% - 24px)", overflow: "auto", overscrollBehavior: "contain" as any }}>' +
    '<DispatchActionPanel $1 selectedTrip={selectedTrip} onActionCompleted={() => { try { window.dispatchEvent(new Event("livetrips:refresh")); } catch {} }} $2 />' +
    '</div>'

  # If it didn't have selectedTrip in props, still wrap the plain component usage
  $m = Try-Replace-Once $m `
    '(?s)<DispatchActionPanel\s+([^>]*?)\/>' `
    '<div style={{ position: "absolute", right: 12, top: 12, zIndex: 60, pointerEvents: "auto", maxHeight: "calc(100% - 24px)", overflow: "auto", overscrollBehavior: "contain" as any }}>' +
    '<DispatchActionPanel $1 onActionCompleted={() => { try { window.dispatchEvent(new Event("livetrips:refresh")); } catch {} }} />' +
    '</div>'
  Write-Host "Restored DispatchActionPanel wrapper (visible + scrollable) + refresh event" -ForegroundColor Green
} else {
  Write-Host "WARN: No <DispatchActionPanel ...> found in LiveTripsMap.tsx" -ForegroundColor Yellow
}

Write-Text $mapPath $m
Write-Host "Patched: $mapPath" -ForegroundColor Green

# ============================================================
# Done
# ============================================================
Write-Host ""
Write-Host "DONE. Now restart dev server cleanly:" -ForegroundColor Cyan
Write-Host "  1) Ctrl+C (stop npm dev)" -ForegroundColor Cyan
Write-Host "  2) npm run dev" -ForegroundColor Cyan
Write-Host "Then test:" -ForegroundColor Cyan
Write-Host "  - Click status buttons on RIGHT => LEFT list updates within 1 refresh" -ForegroundColor Cyan
Write-Host "  - Panel should be visible top-right over the map and scrollable" -ForegroundColor Cyan
