# PATCH-LIVETRIPS-DEV-TESTFLOW.ps1
# Adds dev-only status test buttons to LiveTripsClient (no Mapbox/layout changes).
# Uses existing updateTripStatus + loadPage.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$txt = Get-Content -Raw -Encoding UTF8 $f
$orig = $txt

# 1) Insert helper function near updateTripStatus definition.
# Anchor: "async function updateTripStatus(" (exists in your file)
if ($txt -notmatch 'async function updateTripStatus\(') { Fail "Could not find updateTripStatus() in LiveTripsClient.tsx" }

if ($txt -notmatch 'async function devTestSetStatus\(') {
  $txt = [regex]::Replace(
    $txt,
    '(?s)(async function updateTripStatus\([^\)]*\)\s*\{[\s\S]*?\}\s*)',
@'
$1

async function devTestSetStatus(nextStatus: string) {
  try {
    const target = (selectedTripId && allTrips.find(t => t.id === selectedTripId)) || allTrips[0];
    if (!target?.booking_code) {
      alert("No trip available to test.");
      return;
    }
    await updateTripStatus(target.booking_code, nextStatus);
    await loadPage();
  } catch (e: any) {
    console.error("devTestSetStatus failed", e);
    alert("Dev test failed. Check console.");
  }
}

'@,
    1
  )
}

# 2) Insert a dev-only UI block into the right panel above "Trip actions" header.
# Anchor: the "Trip actions." section (exists in your screenshot: "Trip actions. Select a trip to see actions.")
if ($txt -notmatch 'Trip actions\.' ) { Fail "Could not find 'Trip actions.' text to anchor dev test UI block." }

if ($txt -notmatch 'Dev Test Flow') {
  $txt = [regex]::Replace(
    $txt,
    '(?s)(<h3[^>]*>\s*Trip actions\.\s*</h3>)',
@'
<div style={{ border: "1px solid #eee", padding: 10, borderRadius: 8, marginBottom: 12 }}>
  <div style={{ fontWeight: 600, marginBottom: 8 }}>Dev Test Flow (local only)</div>
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <button type="button" onClick={() => devTestSetStatus("assigned")} style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}>
      Test → assigned
    </button>
    <button type="button" onClick={() => devTestSetStatus("ongoing")} style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}>
      Test → ongoing
    </button>
    <button type="button" onClick={() => devTestSetStatus("completed")} style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}>
      Test → completed
    </button>
  </div>
  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
    Uses selected trip if any, else first trip. Calls existing /api/dispatch/status and refreshes.
  </div>
</div>

$1
'@,
    1
  )
}

# 3) Wrap that block in a dev-only guard: only show when localhost or NODE_ENV=development
# We do a safe minimal approach: inject a small boolean and wrap the block.
if ($txt -notmatch 'const\s+isDev\s*=') {
  $txt = [regex]::Replace(
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
}

# Wrap the dev block we inserted
$txt = $txt.Replace(
  '<div style={{ border: "1px solid #eee", padding: 10, borderRadius: 8, marginBottom: 12 }}>',
  '{isDev ? (<div style={{ border: "1px solid #eee", padding: 10, borderRadius: 8, marginBottom: 12 }}>'
)
$txt = $txt.Replace(
  '</div>' + "`r`n`r`n<h3",
  '</div>) : null}' + "`r`n`r`n<h3"
)

if ($txt -eq $orig) {
  Fail "No changes were applied (unexpected)."
}

Set-Content -Path $f -Value $txt -Encoding UTF8
Write-Host "OK: Added Dev Test Flow buttons (dev-only) to LiveTripsClient." -ForegroundColor Green
Write-Host "Next: restart dev server and try the buttons." -ForegroundColor Cyan
