# PATCH-JRIDE_PHASE8C_ADD_ARRIVED_TAB_AND_FIX_STATUS_PAYLOAD.ps1
# - Adds Arrived tab + counts + dispatch includes arrived
# - Fixes /api/dispatch/status payload to use booking_code (not bookingCode)
# Frontend only: app/admin/livetrips/LiveTripsClient.tsx

$ErrorActionPreference = "Stop"

function Fail($m) { throw "[FAIL] $m" }

$root = Get-Location
$path = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $path)) { Fail "Missing file: $path" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$stamp"
Copy-Item $path $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $path -Raw

# ------------------------------------------------------------
# 1) Fix payload to /api/dispatch/status: bookingCode -> booking_code
# We only touch the calls that target "/api/dispatch/status"
# ------------------------------------------------------------

$before = $txt

# Fix: postJson("/api/dispatch/status", { bookingCode, status })
$txt = $txt -replace 'postJson\(\s*"/api/dispatch/status"\s*,\s*\{\s*bookingCode\s*,\s*status\s*\}\s*\)',
                     'postJson("/api/dispatch/status", { booking_code: bookingCode, status })'

# Fix: fetch("/api/dispatch/status" ... JSON.stringify({ bookingCode, status })
$txt = $txt -replace 'fetch\(\s*"/api/dispatch/status"\s*,(?s:.*?)JSON\.stringify\(\s*\{\s*bookingCode\s*,\s*status\s*\}\s*\)',
                     'fetch("/api/dispatch/status",${1}JSON.stringify({ booking_code: bookingCode, status })'

# The previous replace has a capture (${1}) placeholder but -replace doesn't support template that way.
# So do a safer targeted replace for the exact JSON.stringify object used in the file:
$txt = $txt.Replace('JSON.stringify({ bookingCode, status })', 'JSON.stringify({ booking_code: bookingCode, status })')

if ($txt -eq $before) {
  Write-Host "[WARN] No status payload changes detected (maybe already fixed)." -ForegroundColor Yellow
} else {
  Write-Host "[OK] Fixed status payload to use booking_code." -ForegroundColor Green
}

# ------------------------------------------------------------
# 2) Add Arrived to FilterKey union
# ------------------------------------------------------------
if ($txt -notmatch '\|\s*"arrived"') {
  $anchor = '  | "on_the_way"'  # insert arrived after this line
  if ($txt -notlike "*$anchor*") { Fail 'Could not find FilterKey anchor: | "on_the_way"' }

  $txt = $txt.Replace($anchor, $anchor + "`r`n  | ""arrived""")
  Write-Host "[OK] Added FilterKey: arrived" -ForegroundColor Green
} else {
  Write-Host "[OK] FilterKey already contains arrived" -ForegroundColor Green
}

# ------------------------------------------------------------
# 3) Counts: add arrived
# ------------------------------------------------------------
if ($txt -notmatch 'arrived:\s*0') {
  $countsObjAnchor = "      on_the_way: 0,"
  if ($txt -notlike "*$countsObjAnchor*") { Fail "Could not find counts object anchor: $countsObjAnchor" }

  $txt = $txt.Replace($countsObjAnchor, $countsObjAnchor + "`r`n      arrived: 0,")
  Write-Host "[OK] Added counts.arrived" -ForegroundColor Green
} else {
  Write-Host "[OK] counts.arrived already exists" -ForegroundColor Green
}

if ($txt -notmatch 'if\s*\(s\s*===\s*"arrived"\)\s*c\.arrived\+\+;') {
  $incAnchor = '      if (s === "on_the_way") c.on_the_way++;'
  if ($txt -notlike "*$incAnchor*") { Fail "Could not find counts increment anchor: $incAnchor" }

  $txt = $txt.Replace($incAnchor, $incAnchor + "`r`n      if (s === ""arrived"") c.arrived++;")
  Write-Host "[OK] Added arrived increment in counts" -ForegroundColor Green
} else {
  Write-Host "[OK] counts increment for arrived already exists" -ForegroundColor Green
}

# Dispatch includes arrived
$dispatchIncOld = '      if (["pending", "assigned", "on_the_way"].includes(s)) c.dispatch++;'
$dispatchIncNew = '      if (["pending", "assigned", "on_the_way", "arrived"].includes(s)) c.dispatch++;'
if ($txt -like "*$dispatchIncOld*") {
  $txt = $txt.Replace($dispatchIncOld, $dispatchIncNew)
  Write-Host "[OK] Dispatch count now includes arrived" -ForegroundColor Green
} else {
  Write-Host "[OK] Dispatch count anchor not found (maybe already updated)" -ForegroundColor Yellow
}

# ------------------------------------------------------------
# 4) Visible trips filter: dispatch includes arrived
# ------------------------------------------------------------
$dispatchFilterOld = 'out = allTrips.filter((t) => ["pending", "assigned", "on_the_way"].includes(normStatus(t.status)));'
$dispatchFilterNew = 'out = allTrips.filter((t) => ["pending", "assigned", "on_the_way", "arrived"].includes(normStatus(t.status)));'
if ($txt -like "*$dispatchFilterOld*") {
  $txt = $txt.Replace($dispatchFilterOld, $dispatchFilterNew)
  Write-Host "[OK] Dispatch filter now includes arrived" -ForegroundColor Green
} else {
  Write-Host "[OK] Dispatch filter anchor not found (maybe already updated)" -ForegroundColor Yellow
}

# ------------------------------------------------------------
# 5) Add Arrived pill button after On the way
# ------------------------------------------------------------
if ($txt -notmatch 'setFilterAndFocus\("arrived"\)') {
  $pillAnchor = '<button className={pillClass(tripFilter === "on_the_way")} onClick={() => setFilterAndFocus("on_the_way")}>'
  if ($txt -notlike "*$pillAnchor*") { Fail "Could not find pill anchor for on_the_way button." }

  $arrivedPill = @'
        <button className={pillClass(tripFilter === "arrived")} onClick={() => setFilterAndFocus("arrived")}>
          Arrived <span className="text-xs opacity-80">{counts.arrived}</span>
        </button>

'@

  # Insert after the on_the_way pill block (we insert right before the on_trip pill, safest)
  $onTripAnchor = '<button className={pillClass(tripFilter === "on_trip")} onClick={() => setFilterAndFocus("on_trip")}>'
  if ($txt -notlike "*$onTripAnchor*") { Fail "Could not find on_trip pill anchor to insert Arrived before it." }

  $txt = $txt.Replace($onTripAnchor, $arrivedPill + $onTripAnchor)
  Write-Host "[OK] Added Arrived pill tab" -ForegroundColor Green
} else {
  Write-Host "[OK] Arrived pill already exists" -ForegroundColor Green
}

# ------------------------------------------------------------
# 6) Update Dispatch header text
# ------------------------------------------------------------
$hdrOld = 'Dispatch view (Pending + Assigned + On the way)'
$hdrNew = 'Dispatch view (Pending + Assigned + On the way + Arrived)'
if ($txt -like "*$hdrOld*") {
  $txt = $txt.Replace($hdrOld, $hdrNew)
  Write-Host "[OK] Updated Dispatch header label" -ForegroundColor Green
} else {
  Write-Host "[OK] Dispatch header label not found (maybe different text)" -ForegroundColor Yellow
}

# ------------------------------------------------------------
# Write file
# ------------------------------------------------------------
Set-Content -Path $path -Value $txt -Encoding UTF8
Write-Host "[OK] Wrote: $path" -ForegroundColor Green
Write-Host ""
Write-Host "Next: run build:" -ForegroundColor Cyan
Write-Host "  npm.cmd run build" -ForegroundColor Cyan
