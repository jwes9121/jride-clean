# PATCH-JRIDE_LIVETRIPS_UI_LIFECYCLE_CENTRALIZE_STRICT.ps1
# UI-only. One file only. ASCII only. PowerShell 5 compatible.

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Ok($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }

$root = Get-Location
$rel  = "app\admin\livetrips\LiveTripsClient.tsx"
$path = Join-Path $root $rel

if (!(Test-Path $path)) { Fail "File not found: $path" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$stamp"
Copy-Item $path $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -Raw -Encoding UTF8 $path

# ---- 1) Remove debug=1 page-data query param (no debug bypass) ----
if ($txt -match "/api/admin/livetrips/page-data\?debug=1") {
  $txt = $txt -replace "/api/admin/livetrips/page-data\?debug=1", "/api/admin/livetrips/page-data"
  Ok "Removed ?debug=1 from page-data fetch."
} else {
  Info "page-data fetch did not contain ?debug=1 (skipped)."
}

# ---- 2) Remove uiDebug state + query parsing (no debug bypass UI) ----
# Remove the uiDebug state block:
$patUiDebugState = "(?s)\r?\n\s*//\s*=====\s*PHASE\s*9B\s*DEBUG\s*SIMULATOR.*?\r?\n\s*const\s*\[\s*uiDebug\s*,\s*setUiDebug\s*\]\s*=\s*useState<\s*boolean\s*>\(\s*false\s*\)\s*;\s*\r?\n"
if ([regex]::IsMatch($txt, $patUiDebugState)) {
  $txt = [regex]::Replace($txt, $patUiDebugState, "`r`n")
  Ok "Removed uiDebug state block."
} else {
  Info "uiDebug state block not found (skipped)."
}

# Remove setUiDebug(...) inside useEffect query parsing:
$patSetUiDebug = "(?s)\r?\n\s*try\s*\{\s*\r?\n\s*const\s+qs\s*=\s*new\s+URLSearchParams\(window\.location\.search\s*\|\|\s*""""\s*\)\s*;\s*\r?\n\s*setUiDebug\(\s*qs\.get\(""debug""\)\s*===\s*""1""\s*\)\s*;\s*\r?\n\s*\}\s*catch\s*\{\s*\}\s*\r?\n"
if ([regex]::IsMatch($txt, $patSetUiDebug)) {
  $txt = [regex]::Replace($txt, $patSetUiDebug, "`r`n")
  Ok "Removed setUiDebug query parsing in useEffect."
} else {
  Info "setUiDebug query parsing not found (skipped)."
}

# Remove addDebugProblemTrip + clearDebugTrips functions:
$patDebugFns = "(?s)\r?\n\s*function\s+addDebugProblemTrip\s*\(\)\s*\{.*?\r?\n\s*\}\s*\r?\n\r?\n\s*function\s+clearDebugTrips\s*\(\)\s*\{.*?\r?\n\s*\}\s*\r?\n"
if ([regex]::IsMatch($txt, $patDebugFns)) {
  $txt = [regex]::Replace($txt, $patDebugFns, "`r`n")
  Ok "Removed debug simulator functions."
} else {
  Info "Debug simulator functions not found (skipped)."
}

# Remove the uiDebug buttons block in JSX (Add TEST PROBLEM / Clear TEST trips)
$patUiDebugButtons = "(?s)\r?\n\s*\{\s*uiDebug\s*\?\s*\(\s*\<\>\s*.*?Add\s+TEST\s+PROBLEM.*?Clear\s+TEST\s+trips.*?\<\/\>\s*\)\s*:\s*null\s*\}\s*\r?\n"
if ([regex]::IsMatch($txt, $patUiDebugButtons)) {
  $txt = [regex]::Replace($txt, $patUiDebugButtons, "`r`n")
  Ok "Removed uiDebug JSX buttons."
} else {
  Info "uiDebug JSX buttons not found (skipped)."
}

# ---- 3) Insert centralized lifecycle helper (single source of truth) ----
$anchor = "function nextLifecycleStatus(sEff: string): string | null {"
if ($txt -notmatch [regex]::Escape($anchor)) { Fail "Anchor not found: nextLifecycleStatus" }

# Insert after nextLifecycleStatus(...) block ends (first closing brace after it).
$patNextFn = "(?s)function\s+nextLifecycleStatus\s*\(\s*sEff:\s*string\s*\)\s*:\s*string\s*\|\s*null\s*\{\s*.*?\r?\n\s*\}\s*\r?\n"
if (-not [regex]::IsMatch($txt, $patNextFn)) { Fail "Could not locate full nextLifecycleStatus function block." }

$insert = @"
function isNextTransition(currentEff: string, target: string): boolean {
  const next = nextLifecycleStatus(currentEff);
  return normStatus(next) === normStatus(target);
}

"@

# Only insert if not already present
if ($txt -match "function isNextTransition\(") {
  Info "isNextTransition already present (skipped insert)."
} else {
  $txt = [regex]::Replace($txt, $patNextFn, { param($m) $m.Value + "`r`n" + $insert }, 1)
  Ok "Inserted isNextTransition helper."
}

# ---- 4) Enforce next-only buttons in the table row actions ----
# Replace disabled conditions that use nextLifecycleStatus(...) with isNextTransition(...)
$repls = @(
  @{ from = "disabled={!\\(\\(t as any\\)\\?\\.booking_code\\) \\|\\| nextLifecycleStatus\\(sEff\\) !== ""on_the_way""}";
     to   = "disabled={!((t as any)?.booking_code) || !isNextTransition(sEff, ""on_the_way"")}" },
  @{ from = "disabled={!\\(\\(t as any\\)\\?\\.booking_code\\) \\|\\| nextLifecycleStatus\\(sEff\\) !== ""arrived""}";
     to   = "disabled={!((t as any)?.booking_code) || !isNextTransition(sEff, ""arrived"")}" },
  @{ from = "disabled={!\\(\\(t as any\\)\\?\\.booking_code\\) \\|\\| nextLifecycleStatus\\(sEff\\) !== ""on_trip""}";
     to   = "disabled={!((t as any)?.booking_code) || !isNextTransition(sEff, ""on_trip"")}" },
  @{ from = "disabled={!\\(\\(t as any\\)\\?\\.booking_code\\) \\|\\| nextLifecycleStatus\\(sEff\\) !== ""completed""}";
     to   = "disabled={!((t as any)?.booking_code) || !isNextTransition(sEff, ""completed"")}" }
)

foreach ($r in $repls) {
  if ([regex]::IsMatch($txt, $r.from)) {
    $txt = [regex]::Replace($txt, $r.from, $r.to)
    Ok "Patched table disabled condition: $($r.to)"
  } else {
    Info "Table disabled condition pattern not found (maybe already patched): $($r.to)"
  }
}

# ---- 5) Disable Force buttons (strict lifecycle UI phase) ----
# Force start button: set disabled={true} and update title
$patForceStartDisabled = "title=""Force start \(admin override\)""\s*\r?\n\s*>\s*\r?\n\s*Force start"
if ($txt -match $patForceStartDisabled) {
  $txt = [regex]::Replace($txt, "disabled=\{\!\(\(t as any\)\?\.booking_code\)\}", "disabled={true}", 1)
  $txt = $txt -replace 'title="Force start \(admin override\)"', 'title="Disabled in strict lifecycle mode"'
  Ok "Disabled Force start button."
} else {
  Info "Force start button block not found (skipped)."
}

# Force end button: set disabled={true} and update title
$patForceEndTitle = 'title="Force end \(admin override\)"'
if ($txt -match $patForceEndTitle) {
  $txt = [regex]::Replace($txt, "disabled=\{\!\(\(t as any\)\?\.booking_code\)\}", "disabled={true}", 1)
  $txt = $txt -replace 'title="Force end \(admin override\)"', 'title="Disabled in strict lifecycle mode"'
  Ok "Disabled Force end button."
} else {
  Info "Force end button not found (skipped)."
}

# ---- 6) Enforce next-only buttons in the bottom Trip actions panel ----
# Replace disabled={!selectedBookingCode} with next-only condition using selectedEff
$bottomMap = @(
  @{ label = "On the way"; to = 'disabled={!selectedBookingCode || !isNextTransition(selectedEff, "on_the_way")}' },
  @{ label = "Arrived";   to = 'disabled={!selectedBookingCode || !isNextTransition(selectedEff, "arrived")}' },
  @{ label = "Start trip";to = 'disabled={!selectedBookingCode || !isNextTransition(selectedEff, "on_trip")}' },
  @{ label = "Drop off";  to = 'disabled={!selectedBookingCode || !isNextTransition(selectedEff, "completed")}' }
)

foreach ($bm in $bottomMap) {
  $pat = "(?s)(<button[^>]*\r?\n\s*className=""rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-50""\r?\n\s*onClick=\{\(\)\s*=>\s*updateTripStatus\(\(selectedTrip as any\)\?\.(?:booking_code),\s*""[^""]+""\)\}\r?\n\s*)disabled=\{\!selectedBookingCode\}(\r?\n\s*>$([regex]::Escape($bm.label))</button>)"
  if ([regex]::IsMatch($txt, $pat)) {
    $txt = [regex]::Replace($txt, $pat, ('$1' + $bm.to + '$2'), 1)
    Ok "Bottom panel next-only enforced: $($bm.label)"
  } else {
    Info "Bottom panel button not matched (maybe different formatting or already patched): $($bm.label)"
  }
}

# ---- Write back ----
Set-Content -Path $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Info "Done."
