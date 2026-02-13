# FIX-JRIDE_LIVETRIPS_DISABLE_CURRENT_STATUS_BUTTON_SAFE.ps1
# Restores LiveTripsClient.tsx from known backup, then:
# - Adds selectedEff var
# - Adds disabled styles to status buttons
# - Disables current status buttons (row actions + bottom panel)
# PowerShell 5 compatible, ASCII only.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$target = "app\admin\livetrips\LiveTripsClient.tsx"
$restore = "app\admin\livetrips\LiveTripsClient.tsx.bak.20260102_184836"

if (!(Test-Path $target)) { Fail "Missing file: $target" }
if (!(Test-Path $restore)) { Fail "Missing restore backup: $restore" }

Copy-Item $restore $target -Force
Ok "Restored: $target <= $restore"

# New backup after restore
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

$txt = Get-Content $target -Raw
$orig = $txt

# 1) Add selectedEff next to selectedBookingCode (bottom panel)
$anchorSel = 'const selectedBookingCode = (selectedTrip as any)?.booking_code || null;'
if ($txt -notmatch [regex]::Escape($anchorSel)) { Fail "Could not find selectedBookingCode anchor." }

if ($txt -notmatch 'const\s+selectedEff\s*=') {
  $insSel = @'
const selectedBookingCode = (selectedTrip as any)?.booking_code || null;
  const selectedEff = selectedTrip ? effectiveStatus(selectedTrip as any) : "";

'@
  $txt = $txt.Replace($anchorSel, $insSel)
  Ok "Inserted selectedEff."
} else {
  Info "selectedEff already present; skipping."
}

# 2) Add disabled styles to the standard status button class (only that exact class)
$baseClass = 'className="rounded border px-2 py-1 text-xs hover:bg-gray-50"'
$styledClass = 'className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-50"'
$txt = $txt.Replace($baseClass, $styledClass)

# 3) Row actions: disable if current effective status matches the button
# We patch the disabled prop directly for each status action.
$txt = [regex]::Replace(
  $txt,
  '(?s)updateTripStatus\(\(t as any\)\?\.booking_code,\s*"on_the_way"\);\s*\}\}\s*\r?\n\s*disabled=\{\!\(\(t as any\)\?\.booking_code\)\}',
  'updateTripStatus((t as any)?.booking_code, "on_the_way"); }}' + "`r`n" +
  '                            disabled={!((t as any)?.booking_code) || effectiveStatus(t as any) === "on_the_way"}'
)

$txt = [regex]::Replace(
  $txt,
  '(?s)updateTripStatus\(\(t as any\)\?\.booking_code,\s*"arrived"\);\s*\}\}\s*\r?\n\s*disabled=\{\!\(\(t as any\)\?\.booking_code\)\}',
  'updateTripStatus((t as any)?.booking_code, "arrived"); }}' + "`r`n" +
  '                            disabled={!((t as any)?.booking_code) || effectiveStatus(t as any) === "arrived"}'
)

$txt = [regex]::Replace(
  $txt,
  '(?s)updateTripStatus\(\(t as any\)\?\.booking_code,\s*"on_trip"\);\s*\}\}\s*\r?\n\s*disabled=\{\!\(\(t as any\)\?\.booking_code\)\}',
  'updateTripStatus((t as any)?.booking_code, "on_trip"); }}' + "`r`n" +
  '                            disabled={!((t as any)?.booking_code) || effectiveStatus(t as any) === "on_trip"}'
)

$txt = [regex]::Replace(
  $txt,
  '(?s)updateTripStatus\(\(t as any\)\?\.booking_code,\s*"completed"\);\s*\}\}\s*\r?\n\s*disabled=\{\!\(\(t as any\)\?\.booking_code\)\}',
  'updateTripStatus((t as any)?.booking_code, "completed"); }}' + "`r`n" +
  '                            disabled={!((t as any)?.booking_code) || effectiveStatus(t as any) === "completed"}'
)

# 4) Bottom panel: disable if selectedEff matches
$txt = [regex]::Replace(
  $txt,
  '(?s)updateTripStatus\(\(selectedTrip as any\)\?\.booking_code,\s*"on_the_way"\)\s*\r?\n\s*disabled=\{\!selectedBookingCode\}',
  'updateTripStatus((selectedTrip as any)?.booking_code, "on_the_way")' + "`r`n" +
  '                        disabled={!selectedBookingCode || selectedEff === "on_the_way"}'
)

$txt = [regex]::Replace(
  $txt,
  '(?s)updateTripStatus\(\(selectedTrip as any\)\?\.booking_code,\s*"arrived"\)\s*\r?\n\s*disabled=\{\!selectedBookingCode\}',
  'updateTripStatus((selectedTrip as any)?.booking_code, "arrived")' + "`r`n" +
  '                        disabled={!selectedBookingCode || selectedEff === "arrived"}'
)

$txt = [regex]::Replace(
  $txt,
  '(?s)updateTripStatus\(\(selectedTrip as any\)\?\.booking_code,\s*"on_trip"\)\s*\r?\n\s*disabled=\{\!selectedBookingCode\}',
  'updateTripStatus((selectedTrip as any)?.booking_code, "on_trip")' + "`r`n" +
  '                        disabled={!selectedBookingCode || selectedEff === "on_trip"}'
)

$txt = [regex]::Replace(
  $txt,
  '(?s)updateTripStatus\(\(selectedTrip as any\)\?\.booking_code,\s*"completed"\)\s*\r?\n\s*disabled=\{\!selectedBookingCode\}',
  'updateTripStatus((selectedTrip as any)?.booking_code, "completed")' + "`r`n" +
  '                        disabled={!selectedBookingCode || selectedEff === "completed"}'
)

if ($txt -eq $orig) { Fail "No changes produced (unexpected)." }

[System.IO.File]::WriteAllText($target, $txt, [System.Text.Encoding]::UTF8)
Ok "Patched: current status buttons disabled + greyed out (row + bottom)."
Info "Run npm build next."
