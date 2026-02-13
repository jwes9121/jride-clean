# PATCH-LIVETRIPS-MAP-NODRIVER-INFER-PENDING.ps1
# 1) Prevent getDriverReal() from inferring driver position from pickup/dropoff only
# 2) Make auto-follow center pending/assigned trips on pickup (not dropoff)

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$t = Get-Content -LiteralPath $f -Raw -Encoding UTF8

# --- Patch 1: getDriverReal() early-return when only pickup/dropoff exist and no driver_* fields ---
$rxDriverReal = '(?s)function\s+getDriverReal\s*\(\s*trip:\s*any\s*\)\s*:\s*LngLatTuple\s*\|\s*null\s*\{\s*(?<body>.*?)\r?\n\}'
$m = [regex]::Match($t, $rxDriverReal)
if (!$m.Success) { Fail "Could not locate function getDriverReal(trip: any): LngLatTuple | null" }

$body = $m.Groups["body"].Value

# Insert guard right after explicit check block (after: if (explicit) return explicit;)
$needle = '  const explicit = getExplicitDriver(trip);' + "`r`n" + '  if (explicit) return explicit;'
if ($body -notmatch [regex]::Escape($needle)) {
  Fail "Could not find expected explicit-driver block inside getDriverReal()."
}

$guard = @'
  const explicit = getExplicitDriver(trip);
  if (explicit) return explicit;

  // If this is a booking that only has pickup/dropoff coords (no real driver GPS yet),
  // DO NOT infer driver position from pickup/dropoff. Return null so we can follow pickup.
  const hasPickup = num((trip as any).pickup_lat) != null && num((trip as any).pickup_lng) != null;
  const hasDrop   = num((trip as any).dropoff_lat) != null && num((trip as any).dropoff_lng) != null;
  const hasAnyDriverGps =
    num((trip as any).driver_lat) != null ||
    num((trip as any).driver_lng) != null ||
    num((trip as any).driverLat) != null ||
    num((trip as any).driverLng) != null ||
    num((trip as any).driver_latitude) != null ||
    num((trip as any).driver_longitude) != null;

  if (hasPickup && hasDrop && !hasAnyDriverGps) {
    return null;
  }
'@

$body2 = $body.Replace($needle, $guard.TrimEnd())
$t2 = $t.Substring(0, $m.Index) + ([regex]::Replace($t.Substring($m.Index, $m.Length), [regex]::Escape($body), [System.Text.RegularExpressions.MatchEvaluator]{ param($x) $body2 }, 1)) + $t.Substring($m.Index + $m.Length)

$t = $t2

# --- Patch 2: auto-follow target for pending/assigned should be pickup first ---
$rxAutoFollow = '(?s)\/\/\s*===== AUTO-FOLLOW\s*=====\s*useEffect\(\(\)\s*=>\s*\{.*?\}\s*,\s*\[selectedTripId,\s*trips\]\s*\);'
$m2 = [regex]::Match($t, $rxAutoFollow)
if (!$m2.Success) { Fail "Could not locate AUTO-FOLLOW useEffect block." }

$block = $m2.Value

# Replace only the target selection section
$rxTarget = '(?s)const\s+driverReal\s*=\s*getDriverReal\(raw\);\s*const\s+pickup\s*=\s*getPickup\(raw\);\s*const\s+drop\s*=\s*getDropoff\(raw\);\s*.*?const\s+target:\s*LngLatTuple\s*\|\s*null\s*=\s*driverReal\s*\?\?\s*drop\s*\?\?\s*pickup\s*\?\?\s*null;'
if ($block -notmatch $rxTarget) { Fail "AUTO-FOLLOW target selection did not match expected structure." }

$targetReplace = @'
const driverReal = getDriverReal(raw);
    const pickup = getPickup(raw);
    const drop = getDropoff(raw);

    const status = String(raw.status ?? "").toLowerCase().trim();

    // Pending/assigned: follow pickup (driver isn't moving yet)
    // In-transit: follow driverReal when available, else pickup/drop
    const target: LngLatTuple | null =
      (status === "pending" || status === "assigned")
        ? (pickup ?? drop ?? null)
        : (driverReal ?? pickup ?? drop ?? null);
'@

$block2 = [regex]::Replace($block, $rxTarget, $targetReplace.TrimEnd(), 1)

$t = $t.Substring(0, $m2.Index) + $block2 + $t.Substring($m2.Index + $m2.Length)

Set-Content -LiteralPath $f -Value $t -Encoding UTF8
Write-Host "PATCHED: No driver inference for pending + better follow target in $f" -ForegroundColor Green
