# PATCH-LIVETRIPS-DEV-TESTFLOW-V2.ps1
# Adds dev-only status test buttons to LiveTripsClient (anchors on <TripLifecycleActions ... />)
# No Mapbox/layout changes.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$txt  = Get-Content -Raw -Encoding UTF8 $f
$orig = $txt

# 1) Insert devTestSetStatus() after updateTripStatus() (anchor on function)
if ($txt -notmatch 'async function updateTripStatus\(') { Fail "Could not find updateTripStatus() in LiveTripsClient.tsx" }

if ($txt -notmatch 'async function devTestSetStatus\(') {
  $txt = [regex]::Replace(
    $txt,
    '(?s)(async function updateTripStatus\([^\)]*\)\s*\{[\s\S]*?\}\s*)',
@'
$1

async function devTestSetStatus(nextStatus: string) {
  const target =
    (selectedTripId && allTrips.find((t) => t.id === selectedTripId)) || allTrips[0];
  if (!target?.booking_code) {
    alert("No trip available to test.");
    return;
  }
  await updateTripStatus(target.booking_code, nextStatus);
  await loadPage();
}

'@,
    1
  )
}

# 2) Ensure isDev is defined before the main return(
if ($txt -notmatch '(?m)^\s*const\s+isDev\s*=') {
  # Insert just before the first "return (" in the component body
  $txt2 = [regex]::Replace(
    $txt,
    '(?m)^\s*return\s*\(\s*$',
@'
  const isDev =
    process.env.NODE_ENV === "development" ||
    (typeof window !== "undefined" && window.location.hostname === "localhost");

  return (
'@,
    1
  )
  if ($txt2 -eq $txt) { Fail "Could not insert isDev before return(. The file structure differs." }
  $txt = $txt2
}

# 3) Insert the dev UI block immediately before <TripLifecycleActions ... />
if ($txt -notmatch '<TripLifecycleActions\b') { Fail "Could not find <TripLifecycleActions ... /> in LiveTripsClient.tsx" }

if ($txt -notmatch 'Dev Test Flow \(local only\)') {
  $txt = [regex]::Replace(
    $txt,
    '(?s)(\s*)(<TripLifecycleActions\b)',
@'
$1{isDev ? (
$1  <div style={{ border: "1px solid #eee", padding: 10, borderRadius: 8, marginBottom: 12 }}>
$1    <div style={{ fontWeight: 600, marginBottom: 8 }}>Dev Test Flow (local only)</div>
$1    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
$1      <button type="button" onClick={() => devTestSetStatus("assigned")} style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}>
$1        Test -> assigned
$1      </button>
$1      <button type="button" onClick={() => devTestSetStatus("ongoing")} style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}>
$1        Test -> ongoing
$1      </button>
$1      <button type="button" onClick={() => devTestSetStatus("completed")} style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}>
$1        Test -> completed
$1      </button>
$1    </div>
$1    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
$1      Uses selected trip if any, else first trip. Calls existing /api/dispatch/status and refreshes.
$1    </div>
$1  </div>
$1) : null}
$1$2
'@,
    1
  )
}

if ($txt -eq $orig) { Fail "No changes applied (unexpected)." }

Set-Content -Path $f -Value $txt -Encoding UTF8
Write-Host "OK: Added Dev Test Flow (dev-only) above TripLifecycleActions." -ForegroundColor Green
Write-Host "Next: restart dev server and hard refresh." -ForegroundColor Cyan
