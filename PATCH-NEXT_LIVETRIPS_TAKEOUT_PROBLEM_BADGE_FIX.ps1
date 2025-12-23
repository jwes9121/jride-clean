# C:\Users\jwes9\Desktop\jride-clean-fresh\PATCH-NEXT_LIVETRIPS_TAKEOUT_PROBLEM_BADGE_FIX.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$repo = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$target = Join-Path $repo "app\admin\livetrips\LiveTripsClient.tsx"

if (!(Test-Path $repo)) { Fail "Repo root not found: $repo" }
if (!(Test-Path $target)) { Fail "Target file not found: $target" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup created:`n  $bak" -ForegroundColor Green

$txt = Get-Content $target -Raw

# Replace computeIsProblem() block completely (robust)
$pattern = '(?s)function\s+computeIsProblem\s*\(\s*t\s*:\s*TripRow\s*\)\s*:\s*boolean\s*\{.*?\n\}'
if ($txt -notmatch $pattern) { Fail "Could not find computeIsProblem(t: TripRow): boolean { ... } block to patch." }

$replacement = @'
function computeIsProblem(t: TripRow): boolean {
  const s = normStatus(t.status);
  const mins = minutesSince(t.updated_at || t.created_at || null);

  const isStuck =
    (s === "on_the_way" && mins >= STUCK_THRESHOLDS_MIN.on_the_way) ||
    (s === "on_trip" && mins >= STUCK_THRESHOLDS_MIN.on_trip);

  // TAKEOUT detection (prefer trip_type, fallback to booking_code prefix)
  const tripType = String((t as any).trip_type || (t as any).tripType || "").trim().toLowerCase();
  const code = String(t.booking_code || "").trim().toUpperCase();
  const isTakeout =
    tripType === "takeout" ||
    code.startsWith("TAKEOUT-") ||
    code.startsWith("TAKEOUT_") ||
    code.startsWith("TAKEOUT");

  // Missing coords can be a problem for LOCAL rides, but for TAKEOUT it can be legitimate
  const hasPickup = Number.isFinite(t.pickup_lat as any) && Number.isFinite(t.pickup_lng as any);
  const hasDropoff = Number.isFinite(t.dropoff_lat as any) && Number.isFinite(t.dropoff_lng as any);
  const missingCoords = !isTakeout && isActiveTripStatus(s) && (!hasPickup || !hasDropoff);

  return isStuck || missingCoords;
}
'@

$txt2 = [regex]::Replace(
  $txt,
  $pattern,
  $replacement,
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)

# Extra safety: if any accidental ".StartsWith(" exists, convert to JS ".startsWith("
$txt2 = [regex]::Replace($txt2, "\.StartsWith\s*\(", ".startsWith(")

Set-Content -Path $target -Value $txt2 -Encoding UTF8

$after = Get-Content $target -Raw
if ($after -notmatch "const isTakeout") { Fail "Patch sanity failed: isTakeout logic not found after write." }

Write-Host "[DONE] TAKEOUT PROBLEM badge fix applied:`n  $target" -ForegroundColor Green
