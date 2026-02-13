# PATCH-JRIDE_LIVETRIPS_NEXT_STATE_ONLY.ps1
# LiveTrips: only NEXT lifecycle status button is clickable.
# Previous/current/future (skip) buttons are disabled + grey (via existing disabled styles).
# PowerShell 5 compatible, ASCII only.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$target = "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

$txt = Get-Content $target -Raw
$orig = $txt

# 1) Insert nextLifecycleStatus helper (once) after effectiveStatus()
if ($txt -notmatch "function\s+nextLifecycleStatus\s*\(") {
  $anchor = "function effectiveStatus(t: any): string {"
  if ($txt -notmatch [regex]::Escape($anchor)) { Fail "Could not find effectiveStatus() anchor." }

  # Insert right after effectiveStatus() block end: we locate the closing '}' that ends it.
  $rx = '(?s)(function\s+effectiveStatus\(t:\s*any\):\s*string\s*\{.*?\n\})'
  $m = [regex]::Match($txt, $rx)
  if (!$m.Success) { Fail "Could not locate effectiveStatus() block for insertion." }

  $helper = @'

function nextLifecycleStatus(sEff: string): string | null {
  // Next-only lifecycle:
  // assigned -> on_the_way -> arrived -> on_trip -> completed
  // Anything else: no next step
  const s = normStatus(sEff);
  if (s === "assigned") return "on_the_way";
  if (s === "on_the_way") return "arrived";
  if (s === "arrived" || s === "enroute") return "on_trip";
  if (s === "on_trip") return "completed";
  return null;
}

'@

  $txt = $txt.Substring(0, $m.Index + $m.Length) + $helper + $txt.Substring($m.Index + $m.Length)
  Ok "Inserted nextLifecycleStatus()."
} else {
  Info "nextLifecycleStatus() already present; skipping."
}

# 2) ROW ACTIONS: change disabled logic to "nextLifecycleStatus(sEff) must equal button status"
# File already has: const sEff = effectiveStatus(t);

# On the way
$txt = $txt -replace [regex]::Escape('disabled={!((t as any)?.booking_code) || effectiveStatus(t as any) === "on_the_way"}'),
  'disabled={!((t as any)?.booking_code) || nextLifecycleStatus(sEff) !== "on_the_way"}'

# Arrived
$txt = $txt -replace [regex]::Escape('disabled={!((t as any)?.booking_code) || effectiveStatus(t as any) === "arrived"}'),
  'disabled={!((t as any)?.booking_code) || nextLifecycleStatus(sEff) !== "arrived"}'

# Start trip (on_trip)
$txt = $txt -replace [regex]::Escape('disabled={!((t as any)?.booking_code) || effectiveStatus(t as any) === "on_trip"}'),
  'disabled={!((t as any)?.booking_code) || nextLifecycleStatus(sEff) !== "on_trip"}'

# Drop off (completed)
$txt = $txt -replace [regex]::Escape('disabled={!((t as any)?.booking_code) || effectiveStatus(t as any) === "completed"}'),
  'disabled={!((t as any)?.booking_code) || nextLifecycleStatus(sEff) !== "completed"}'

# 3) BOTTOM "Trip actions" PANEL: only next status enabled
# Ensure selectedEff exists (it does in your file), then update each disabled=
$txt = [regex]::Replace(
  $txt,
  '(?m)^\s*disabled=\{\!selectedBookingCode(\s*\|\|\s*selectedEff\s*===\s*"[a-z_]+")?\}\s*$',
  { param($m) $m.Value }  # no-op: we patch per button below
)

# Patch each button block by matching the updateTripStatus call and replacing the disabled line below it
$txt = [regex]::Replace(
  $txt,
  '(?s)(updateTripStatus\(\(selectedTrip as any\)\?\.booking_code,\s*"on_the_way"\)\s*\r?\n\s*disabled=\{)([^}]*)(\})',
  '$1!selectedBookingCode || nextLifecycleStatus(selectedEff) !== "on_the_way"$3'
)

$txt = [regex]::Replace(
  $txt,
  '(?s)(updateTripStatus\(\(selectedTrip as any\)\?\.booking_code,\s*"arrived"\)\s*\r?\n\s*disabled=\{)([^}]*)(\})',
  '$1!selectedBookingCode || nextLifecycleStatus(selectedEff) !== "arrived"$3'
)

$txt = [regex]::Replace(
  $txt,
  '(?s)(updateTripStatus\(\(selectedTrip as any\)\?\.booking_code,\s*"on_trip"\)\s*\r?\n\s*disabled=\{)([^}]*)(\})',
  '$1!selectedBookingCode || nextLifecycleStatus(selectedEff) !== "on_trip"$3'
)

$txt = [regex]::Replace(
  $txt,
  '(?s)(updateTripStatus\(\(selectedTrip as any\)\?\.booking_code,\s*"completed"\)\s*\r?\n\s*disabled=\{)([^}]*)(\})',
  '$1!selectedBookingCode || nextLifecycleStatus(selectedEff) !== "completed"$3'
)

if ($txt -eq $orig) { Fail "No changes produced (already patched or anchors not found)." }

[System.IO.File]::WriteAllText($target, $txt, [System.Text.Encoding]::UTF8)
Ok "Patched: only NEXT lifecycle button is enabled (row + bottom panel)."
Ok "Next: npm run build"
