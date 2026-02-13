# PATCH-JRIDE_PHASE9_MILESTONES_FORCE_SAFETY_AUDIT_FIX.ps1
# - Adds "Arrived at pickup" milestone button (status=arrived) near Start trip in LiveTripsClient
# - Locks down Force buttons visibility (only show in valid statuses; hide on completed/cancelled)
# - Fixes FORCE_STATUS audit bug in /api/dispatch/status route.ts (to_status used undefined `status`)
# - No manual edits

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m){ throw "[FAIL] $m" }

# ---- Paths (repo-root relative) ----
$clientPath = "app\admin\livetrips\LiveTripsClient.tsx"
$statusPath = "app\api\dispatch\status\route.ts"

if(!(Test-Path $clientPath)){ Fail "Missing file: $clientPath" }
if(!(Test-Path $statusPath)){ Fail "Missing file: $statusPath" }

# ---- Backups ----
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $clientPath "$clientPath.bak.$ts" -Force
Copy-Item $statusPath  "$statusPath.bak.$ts"  -Force
Ok "Backups created (*.bak.$ts)."

# =========================
# 1) Patch Status API audit bug + ensure FORCE logs won't fail
# =========================
$stxt = Get-Content $statusPath -Raw -Encoding UTF8

# Fix: to_status: status ?? null  --> to_status: target ?? null
if($stxt.Contains("to_status: status ?? null")){
  $stxt = $stxt.Replace("to_status: status ?? null", "to_status: target ?? null")
  Ok "Status API: fixed to_status (status -> target)."
} else {
  Warn "Status API: did not find 'to_status: status ?? null' (maybe already fixed)."
}

# Also fix any accidental reference `to_status: status,` (without ?? null)
if($stxt.Contains("to_status: status,")){
  $stxt = $stxt.Replace("to_status: status,", "to_status: target,")
  Ok "Status API: fixed to_status (status, -> target,)."
}

Set-Content -LiteralPath $statusPath -Value $stxt -Encoding UTF8
Ok "Status API: wrote changes."

# =========================
# 2) Patch LiveTripsClient: add Arrived-at-pickup button + lock Force buttons
# =========================
$ctxt = Get-Content $clientPath -Raw -Encoding UTF8

# ---- A) Insert "Arrived at pickup" button before an existing Start trip button block ----
# We handle two common variants:
#   Variant 1: title uses s !== "on_the_way" ... "Start trip"
#   Variant 2: plain JSX label >Start trip<
#
# Inserted button:
#   - enabled only when s === "on_the_way"
#   - calls updateTripStatus(booking_code, "arrived")
#
# NOTE: We DO NOT assume forceTripStatus exists. We use your existing updateTripStatus call pattern.

$inserted = $false

# Variant 1 anchor: title ... : "Start trip"
$anchor1 = 'title={s !== "on_the_way" ? "Allowed only when status=on_the_way" : "Start trip"}'
if($ctxt.Contains($anchor1) -and ($ctxt -notmatch "Arrived at pickup")) {
  # Insert a full button block right BEFORE the <button ... Start trip ...>
  # We do this by locating the nearest preceding "<button" for Start trip button.
  $pos = $ctxt.IndexOf($anchor1)
  $btnStart = $ctxt.LastIndexOf("<button", $pos)
  if($btnStart -lt 0){ Fail "LiveTripsClient: Found Start trip title anchor but could not locate preceding <button." }

  $arrivedBtn = @"
                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                              onClick={(e) => { e.stopPropagation(); if (!t.booking_code) return; updateTripStatus(t.booking_code, "arrived").then(loadPage).catch((err) => setLastAction(String(err?.message || err))); }}
                              disabled={s !== "on_the_way"}
                              title={s !== "on_the_way" ? "Allowed only when status=on_the_way" : "Arrived at pickup"}
                            >
                              Arrived
                            </button>

"@

  $ctxt = $ctxt.Substring(0, $btnStart) + $arrivedBtn + $ctxt.Substring($btnStart)
  $inserted = $true
  Ok "LiveTripsClient: inserted 'Arrived' milestone button before Start trip (variant 1)."
}

# Variant 2 anchor: >Start trip<
if((-not $inserted) -and ($ctxt -notmatch "Arrived at pickup") -and $ctxt.Contains(">Start trip<")) {
  $pos2 = $ctxt.IndexOf(">Start trip<")
  $btnStart2 = $ctxt.LastIndexOf("<button", $pos2)
  if($btnStart2 -lt 0){ Fail "LiveTripsClient: Found '>Start trip<' but could not locate preceding <button." }

  # Try to detect whether this block uses (t.booking_code) or (selectedTrip.booking_code).
  # We'll default to `t.booking_code` which is what your table row uses.
  $arrivedBtn2 = @"
                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                              onClick={(e) => { e.stopPropagation(); if (!t.booking_code) return; updateTripStatus(t.booking_code, "arrived").then(loadPage).catch((err) => setLastAction(String(err?.message || err))); }}
                              disabled={s !== "on_the_way"}
                              title={s !== "on_the_way" ? "Allowed only when status=on_the_way" : "Arrived at pickup"}
                            >
                              Arrived
                            </button>

"@
  $ctxt = $ctxt.Substring(0, $btnStart2) + $arrivedBtn2 + $ctxt.Substring($btnStart2)
  $inserted = $true
  Ok "LiveTripsClient: inserted 'Arrived' milestone button before Start trip (variant 2)."
}

if(-not $inserted){
  Warn "LiveTripsClient: did not insert Arrived button (either already present or Start trip block differs)."
}

# ---- B) Force button safety: hide on completed/cancelled + show only when meaningful ----
# We apply simple safeguards based on label strings, without regex guessing:
# - If file contains 'Force start' button, wrap it with a guard:
#     {(["on_the_way","arrived","enroute"].includes(s)) ? ( ...Force start button... ) : null}
# - If file contains 'Force end' button, wrap it:
#     {(s === "on_trip") ? ( ...Force end button... ) : null}
# - If file contains 'Purge broken trips' inline per-row, hide it on completed/cancelled:
#     {(s !== "completed" && s !== "cancelled") ? ... : null}
#
# If your file uses a different variable name than `s`, these guards might not match. Your current LiveTripsClient uses `s`.

function WrapOnce([string]$text, [string]$needle, [string]$wrapPrefix, [string]$wrapSuffix) {
  # Wrap the FIRST occurrence of the JSX <button ...> block containing $needle (label text)
  $i = $text.IndexOf($needle)
  if($i -lt 0){ return @{ changed=$false; text=$text } }

  $btnOpen = $text.LastIndexOf("<button", $i)
  if($btnOpen -lt 0){ return @{ changed=$false; text=$text } }

  $btnClose = $text.IndexOf("</button>", $i)
  if($btnClose -lt 0){ return @{ changed=$false; text=$text } }
  $btnClose = $btnClose + "</button>".Length

  $block = $text.Substring($btnOpen, $btnClose - $btnOpen)

  # Avoid double-wrap if already guarded
  if($block.Contains($wrapPrefix.Trim())){ return @{ changed=$false; text=$text } }

  $wrapped = $wrapPrefix + $block + $wrapSuffix
  $newText = $text.Substring(0, $btnOpen) + $wrapped + $text.Substring($btnClose)
  return @{ changed=$true; text=$newText }
}

$changedSafety = $false

# Force start
if($ctxt.Contains("Force start")){
  $res = WrapOnce $ctxt "Force start" '{(["on_the_way","arrived","enroute"].includes(s)) ? (' ') : null}'
  if($res.changed){
    $ctxt = $res.text
    $changedSafety = $true
    Ok "LiveTripsClient: guarded 'Force start' (only on_the_way/arrived/enroute)."
  } else {
    Warn "LiveTripsClient: 'Force start' found but guard not applied (maybe already guarded or structure differs)."
  }
} else {
  Warn "LiveTripsClient: no 'Force start' label found (skipping guard)."
}

# Force end
if($ctxt.Contains("Force end")){
  $res = WrapOnce $ctxt "Force end" '{(s === "on_trip") ? (' ') : null}'
  if($res.changed){
    $ctxt = $res.text
    $changedSafety = $true
    Ok "LiveTripsClient: guarded 'Force end' (only on_trip)."
  } else {
    Warn "LiveTripsClient: 'Force end' found but guard not applied (maybe already guarded or structure differs)."
  }
} else {
  Warn "LiveTripsClient: no 'Force end' label found (skipping guard)."
}

# Purge broken trips (per-row button)
if($ctxt.Contains("Purge broken trips")){
  $res = WrapOnce $ctxt "Purge broken trips" '{(s !== "completed" && s !== "cancelled") ? (' ') : null}'
  if($res.changed){
    $ctxt = $res.text
    $changedSafety = $true
    Ok "LiveTripsClient: guarded 'Purge broken trips' (hidden on completed/cancelled)."
  } else {
    Warn "LiveTripsClient: 'Purge broken trips' found but guard not applied (maybe already guarded or structure differs)."
  }
}

Set-Content -LiteralPath $clientPath -Value $ctxt -Encoding UTF8
Ok "LiveTripsClient: wrote changes."

Ok "Phase 9 patch complete."
Write-Host ""
Write-Host "NEXT:" -ForegroundColor Cyan
Write-Host "  1) Build: npm.cmd run build"
Write-Host "  2) Open /admin/livetrips and confirm:" 
Write-Host "     - On the way: you see Arrived (milestone), Start trip"
Write-Host "     - Arrived: you see Start trip"
Write-Host "     - On trip: you see Drop off / Force end"
Write-Host "     - Completed/Cancelled: no Force/Purge per-row buttons"
Write-Host ""
Write-Host "If FORCE_STATUS still doesn't show, click Force end once, then rerun audit SQL." -ForegroundColor Yellow
