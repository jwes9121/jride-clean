# FIX-JRIDE_PHASE3G_LIVETRIPS_ACTIONS_TRIPID_AND_ZEROCOORDS_V1.ps1
# - LiveTrips actions: include trip_id so takeout rows (booking_code null) can be acted on
# - Disable auto-assign when coords are null OR 0/0

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$bak = "$target.bak.{0}" -f (Get-Date -Format "yyyyMMdd_HHmmss")
Copy-Item $target $bak -Force
Ok "Backup: $bak"

$txt = Get-Content $target -Raw

# 1) Ensure callLiveTripsAction() sends trip_id as well as booking_code
# We look for the JSON.stringify({ action, booking_code: ... }) style block.
$anchor1 = 'body:\s*JSON\.stringify\(\s*\{\s*action\s*,'
if ($txt -notmatch $anchor1) {
  Fail "Could not find action POST JSON.stringify({ action, ... }) block in LiveTripsClient.tsx"
}

# Insert trip_id right after action in the body object if not already present
if ($txt -notmatch 'trip_id\s*:') {
  $txt = [regex]::Replace(
    $txt,
    '(body:\s*JSON\.stringify\(\s*\{\s*action\s*,)',
    '$1 trip_id: String(((t as any)?.id ?? (t as any)?.trip_id ?? "") || "") || null,',
    1
  )
  Ok "Inserted trip_id into LiveTrips action request body."
} else {
  Info "trip_id already present in LiveTrips action request body. Skipping."
}

# 2) Make canAutoAssign treat 0/0 as missing
# We patch the canAutoAssign computation area by replacing a simple coord check with a safer helper.
# Add helper near canAutoAssign block if not present.
if ($txt -notmatch 'function\s+hasValidCoords') {
  $txt = [regex]::Replace(
    $txt,
    '(const\s+primaryProblemAction[\s\S]*?\n)',
    @"
`$1
function hasValidCoords(t: any): boolean {
  const pl = Number((t as any)?.pickup_lat);
  const pg = Number((t as any)?.pickup_lng);
  const dl = Number((t as any)?.dropoff_lat);
  const dg = Number((t as any)?.dropoff_lng);

  // Treat null/undefined/NaN as invalid, and also treat 0/0 as invalid for your PH deployment
  const okP = Number.isFinite(pl) && Number.isFinite(pg) && !(pl === 0 && pg === 0);
  const okD = Number.isFinite(dl) && Number.isFinite(dg) && !(dl === 0 && dg === 0);
  return okP && okD;
}

"@,
    1
  )
  Ok "Inserted hasValidCoords() helper."
} else {
  Info "hasValidCoords() already present. Skipping helper insert."
}

# Now replace usages of canAutoAssign coord checks with hasValidCoords(t) when possible.
# Common pattern we saw earlier: title={!canAutoAssign ? "Requires pickup & dropoff coordinates" : ...}
# We'll patch assignment: const canAutoAssign = ... into using hasValidCoords(t)
if ($txt -match 'const\s+canAutoAssign\s*=\s*') {
  $txt2 = [regex]::Replace(
    $txt,
    'const\s+canAutoAssign\s*=\s*([^\r\n;]+);',
    'const canAutoAssign = hasValidCoords(t);',
    1
  )
  if ($txt2 -ne $txt) {
    $txt = $txt2
    Ok "Patched canAutoAssign to use hasValidCoords(t)."
  } else {
    Info "Could not patch canAutoAssign automatically (pattern mismatch). Leaving as-is."
  }
} else {
  Info "No canAutoAssign assignment found (pattern mismatch)."
}

# Write back UTF-8
Set-Content -LiteralPath $target -Value $txt -Encoding utf8
Ok "Patched: $target"

Write-Host ""
Write-Host "[NEXT] Run build:" -ForegroundColor Yellow
Write-Host "npm run build" -ForegroundColor Yellow
