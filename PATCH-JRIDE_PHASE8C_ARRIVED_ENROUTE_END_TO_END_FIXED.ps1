# PATCH-JRIDE_PHASE8C_ARRIVED_ENROUTE_END_TO_END_FIXED.ps1
# - Adds FilterKey: arrived + enroute
# - Makes dispatch tab/list include arrived + enroute (so no "count=1 but list empty")
# - Makes stuck watcher treat arrived/enroute like on_the_way
# - Adds row actions:
#     Arrived: on_the_way -> arrived
#     Start trip: arrived/enroute -> on_trip
#     Drop off: on_trip -> completed
# - Keeps Force buttons untouched (fallback only)
# - No Mapbox/layout changes beyond tabs + action buttons

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function BackupFile($path) {
  if (!(Test-Path $path)) { Fail "File not found: $path" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak.$ts"
  Copy-Item $path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function LoadTextUtf8NoBom($path) {
  $t = Get-Content -LiteralPath $path -Raw -Encoding UTF8
  # strip BOM if present
  if ($t.Length -gt 0 -and [int]$t[0] -eq 0xFEFF) { $t = $t.Substring(1) }
  return $t
}
function SaveTextUtf8NoBom($path, $text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

# -------- target files --------
$repoRoot = (Get-Location).Path
$liveTripsClient = Join-Path $repoRoot "app\admin\livetrips\LiveTripsClient.tsx"

BackupFile $liveTripsClient
$txt = LoadTextUtf8NoBom $liveTripsClient

# -------- 1) FilterKey: add arrived + enroute --------
if ($txt -notmatch '"arrived"') {
  $pattern = 'type\s+FilterKey\s*=\s*(?:\r?\n|\r)(?:\s*\|\s*"[a-z_]+"[^\r\n]*(?:\r?\n|\r))+?\s*\|\s*"problem"\s*;'
  if ($txt -match $pattern) {
    $replacement = @'
type FilterKey =
  | "dispatch" // pending + assigned + on_the_way + arrived + enroute
  | "pending"
  | "assigned"
  | "on_the_way"
  | "arrived"
  | "enroute"
  | "on_trip"
  | "completed"
  | "cancelled"
  | "problem";
'@
    $txt = [regex]::Replace($txt, $pattern, $replacement, "Singleline")
    Write-Host "[OK] Patched FilterKey union (added arrived, enroute)."
  } else {
    Fail "Could not locate 'type FilterKey' block to patch."
  }
} else {
  Write-Host "[OK] FilterKey already includes arrived (skip)."
}

# -------- 2) counts.dispatch: include arrived + enroute --------
# Find the line that increments dispatch count
$before = $txt
$txt = $txt -replace '\(\["pending",\s*"assigned",\s*"on_the_way"\]\.includes\(s\)\)\s*c\.dispatch\+\+;',
                     '(["pending","assigned","on_the_way","arrived","enroute"].includes(s)) c.dispatch++;'
if ($txt -ne $before) {
  Write-Host "[OK] Patched counts.dispatch grouping to include arrived/enroute."
} else {
  Write-Host "[WARN] counts.dispatch grouping pattern not found (may already be patched)."
}

# -------- 3) visibleTrips dispatch filter: include arrived + enroute --------
$before = $txt
$txt = $txt -replace 'out\s*=\s*allTrips\.filter\(\(t\)\s*=>\s*\["pending",\s*"assigned",\s*"on_the_way"\]\.includes\(normStatus\(t\.status\)\)\)\s*;',
                     'out = allTrips.filter((t) => ["pending","assigned","on_the_way","arrived","enroute"].includes(normStatus(t.status)));'
if ($txt -ne $before) {
  Write-Host "[OK] Patched dispatch list filter to include arrived/enroute."
} else {
  Write-Host "[WARN] dispatch list filter pattern not found (may already be patched)."
}

# -------- 4) stuck watcher: treat arrived/enroute like on_the_way --------
$before = $txt
$txt = $txt -replace '\(s\s*===\s*"on_the_way"\s*&&\s*mins\s*>=\s*STUCK_THRESHOLDS_MIN\.on_the_way\)',
                     '((s === "on_the_way" || s === "arrived" || s === "enroute") && mins >= STUCK_THRESHOLDS_MIN.on_the_way)'
if ($txt -ne $before) {
  Write-Host "[OK] Patched stuck watcher to include arrived/enroute threshold."
} else {
  Write-Host "[WARN] stuck watcher pattern not found (may already be patched)."
}

# -------- 5) Row actions: add Arrived button and correct Start trip rule --------
$actionsPattern = [regex]::Escape('{/* Minimal inline status actions */') + '[\s\S]*?' + [regex]::Escape('</div>') + '\s*</td>'
if ($txt -match $actionsPattern) {
  $newActions = @'
{/* Minimal inline status actions */}
                          <div className="flex flex-wrap gap-2 items-center">
                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!t.booking_code) return;
                                updateTripStatus(t.booking_code, "on_the_way").catch((err) => setLastAction(String(err?.message || err)));
                              }}
                              disabled={s !== "assigned"}
                              title={s !== "assigned" ? "Allowed only when status=assigned" : "Mark on_the_way"}
                            >
                              On the way
                            </button>

                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!t.booking_code) return;
                                updateTripStatus(t.booking_code, "arrived").catch((err) => setLastAction(String(err?.message || err)));
                              }}
                              disabled={s !== "on_the_way"}
                              title={s !== "on_the_way" ? "Allowed only when status=on_the_way" : "Arrived at pickup"}
                            >
                              Arrived
                            </button>

                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!t.booking_code) return;
                                updateTripStatus(t.booking_code, "on_trip").catch((err) => setLastAction(String(err?.message || err)));
                              }}
                              disabled={!(s === "arrived" || s === "enroute")}
                              title={!(s === "arrived" || s === "enroute") ? "Allowed only when status=arrived or enroute" : "Start trip"}
                            >
                              Start trip
                            </button>

                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!t.booking_code) return;
                                updateTripStatus(t.booking_code, "completed").catch((err) => setLastAction(String(err?.message || err)));
                              }}
                              disabled={s !== "on_trip"}
                              title={s !== "on_trip" ? "Allowed only when status=on_trip" : "Complete trip"}
                            >
                              Drop off
                            </button>

                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTripId(id);
                                setFilterAndFocus("problem");
                              }}
                              title="Focus Problem trips view"
                            >
                              Find problem
                            </button>
                          </div>
                        </td>
'@
  $txt = [regex]::Replace($txt, $actionsPattern, $newActions, "Singleline")
  Write-Host "[OK] Patched row actions (Arrived + Start trip rules)."
} else {
  Write-Host "[WARN] Could not locate row actions block to patch. (Maybe structure changed.)"
}

# -------- Save --------
SaveTextUtf8NoBom $liveTripsClient $txt
Write-Host "[OK] Wrote: app\admin\livetrips\LiveTripsClient.tsx"

Write-Host ""
Write-Host "NEXT:"
Write-Host '1) Build: powershell -NoProfile -ExecutionPolicy Bypass -Command "npm run build"'
Write-Host "2) If build is OK, test in /admin/livetrips: Dispatch includes Arrived+Enroute, and buttons follow lifecycle."
