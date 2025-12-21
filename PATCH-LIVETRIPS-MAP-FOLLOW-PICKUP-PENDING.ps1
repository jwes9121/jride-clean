# PATCH-LIVETRIPS-MAP-FOLLOW-PICKUP-PENDING.ps1
# Robust:
# 1) Replace getDriverReal() to avoid "fake driver at dropoff" for pending/assigned
# 2) Replace the auto-follow "const target = ..." statement (any formatting) that uses driverReal

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$t = Get-Content -LiteralPath $f -Raw -Encoding UTF8

# -------------------------
# 1) Replace getDriverReal()
# -------------------------
$rxFn = '(?s)function\s+getDriverReal\s*\(\s*trip:\s*any\s*\)\s*:\s*LngLatTuple\s*\|\s*null\s*\{.*?\r?\n\}'
if ($t -notmatch $rxFn) {
  Fail "Could not locate function getDriverReal(trip: any): LngLatTuple | null"
}

$newFn = @'
function getDriverReal(trip: any): LngLatTuple | null {
  // Prefer explicit driver GPS fields
  const explicit = getExplicitDriver(trip);
  if (explicit) return explicit;

  // If booking only has pickup/dropoff (no driver GPS yet), do NOT infer driver from them.
  const hasPickup = num(trip?.pickup_lat) != null && num(trip?.pickup_lng) != null;
  const hasDrop   = num(trip?.dropoff_lat) != null && num(trip?.dropoff_lng) != null;

  const hasAnyDriverGps =
    num(trip?.driver_lat) != null ||
    num(trip?.driver_lng) != null ||
    num(trip?.driverLat) != null ||
    num(trip?.driverLng) != null ||
    num(trip?.driver_latitude) != null ||
    num(trip?.driver_longitude) != null;

  if (hasPickup && hasDrop && !hasAnyDriverGps) {
    return null;
  }

  // Otherwise, best-effort fallback from all coords (legacy)
  const coords = getAllCoords(trip);
  if (!coords.length) return null;
  if (coords.length === 1) return coords[0];
  if (coords.length === 2) return coords[1];
  return coords[coords.length - 2];
}
'@

$t = [regex]::Replace($t, $rxFn, ($newFn -replace '\r?\n', "`r`n"), 1)

# ---------------------------------------------------
# 2) Replace AUTO-FOLLOW target statement (robust)
# ---------------------------------------------------
# We replace the FIRST "const target ... = ...;" statement that:
# - contains "driverReal"
# - and also references pickup/drop (any order)
$rxTargetAny = '(?s)const\s+target\b[^=]*=\s*[^;]*;'
$matches = [regex]::Matches($t, $rxTargetAny)

$found = $false
for ($i=0; $i -lt $matches.Count; $i++) {
  $stmt = $matches[$i].Value
  if ($stmt -match 'driverReal' -and ($stmt -match 'pickup' -or $stmt -match 'drop')) {
    $replacementTarget = @'
const status = String(raw.status ?? "").toLowerCase().trim();

// Pending/assigned: follow pickup (driver not moving yet)
// Otherwise: follow driverReal when available
const target: LngLatTuple | null =
  (status === "pending" || status === "assigned")
    ? (pickup ?? drop ?? null)
    : (driverReal ?? pickup ?? drop ?? null);
'@
    # Replace exactly this matched statement once
    $escaped = [regex]::Escape($stmt)
    $t = [regex]::Replace($t, $escaped, ($replacementTarget -replace '\r?\n', "`r`n"), 1)
    $found = $true
    break
  }
}

if (-not $found) {
  Fail "Could not locate a 'const target = ...;' statement that references driverReal + pickup/drop. We need to inspect the auto-follow block."
}

Set-Content -LiteralPath $f -Value $t -Encoding UTF8
Write-Host "PATCHED: getDriverReal + auto-follow target in $f" -ForegroundColor Green
