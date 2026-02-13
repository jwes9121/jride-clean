# PATCH-FIX-DISPATCH-BOOKINGS-TAKEOUT-EXPRESS.ps1
# Fix dispatch booking creation for Takeout Regular/Express without assuming non-existent bookings columns.
# - Adds missing comma after takeout_service_level
# - Removes insert keys that don't exist in your schema cache
# - Allows takeout create without pickup_lat/pickup_lng
# - Fixes inverted isAllowed(role) auth gate if present
# Creates a timestamped .bak backup.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$file = Join-Path $root "app\api\dispatch\bookings\route.ts"
if (!(Test-Path $file)) { Fail "Missing file: $file" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$file.bak.$stamp"
Copy-Item $file $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $file -Raw

# --- 1) Fix inverted auth gate (common bug) ---
# GET
$txt = $txt -replace 'if\s*\(\s*isAllowed\s*\(\s*role\s*\)\s*\)\s*return\s+jsonError\(\s*["'']Forbidden["'']\s*,\s*403\s*\)\s*;\s*',
                    'if (!isAllowed(role)) return jsonError("Forbidden", 403);'
# POST
$txt = $txt -replace 'if\s*\(\s*isAllowed\s*\(\s*role\s*\)\s*\)\s*return\s+jsonError\(\s*["'']Forbidden["'']\s*,\s*403\s*\)\s*;\s*',
                    'if (!isAllowed(role)) return jsonError("Forbidden", 403);'

# --- 2) Ensure takeout_service_level line has trailing comma inside insert object ---
# Handles: takeout_service_level: something  (missing comma)
$txt = [regex]::Replace(
  $txt,
  '(?m)^(?<indent>\s*)takeout_service_level\s*:\s*(?<expr>.+?)\s*$',
  '${indent}takeout_service_level: ${expr},'
)

# --- 3) Remove non-existent bookings columns from the insert payload (only removes "key: ..." lines) ---
# These are the ones you reported from schema-cache errors
$badKeys = @(
  "dispatcher_email",
  "rider_name",
  "rider_phone",
  "pickup_label",
  "dropoff_label",
  "distance_km",
  "fare",
  "notes"
)

foreach ($k in $badKeys) {
  $pattern = "(?m)^\s*$k\s*:\s*.+?,?\s*\r?\n"
  $txt = [regex]::Replace($txt, $pattern, "")
}

# --- 4) Allow takeout booking creation without pickup_lat/pickup_lng ---
# Replace the strict validation line if it exists:
#   if (!pickup_lat || !pickup_lng || !town) return jsonError("pickup_lat, pickup_lng, town required");
$txt = $txt -replace '(?m)^\s*if\s*\(\s*!\s*pickup_lat\s*\|\|\s*!\s*pickup_lng\s*\|\|\s*!\s*town\s*\)\s*return\s+jsonError\(\s*["'']pickup_lat,\s*pickup_lng,\s*town\s*required["'']\s*\)\s*;\s*$',
@'
  const serviceType = String((body as any)?.service_type ?? (body as any)?.trip_type ?? "").toLowerCase();
  const isTakeout = serviceType === "takeout";
  if (!town) return jsonError("town required");
  // Takeout orders in dispatch panel do not provide coordinates; allow create without pickup_lat/pickup_lng
  if (!isTakeout) {
    if (!pickup_lat || !pickup_lng) return jsonError("pickup_lat, pickup_lng required");
  }
'@

# --- 5) Final sanity checks ---
# Must not have "if (isAllowed(role)) return Forbidden"
if ($txt -match 'if\s*\(\s*isAllowed\s*\(\s*role\s*\)\s*\)\s*return\s+jsonError\(\s*["'']Forbidden["'']\s*,\s*403') {
  Fail "Sanity failed: still found inverted auth gate (isAllowed(role)) -> Forbidden"
}

# Ensure insert object isn't broken by missing comma after takeout_service_level
# (We just fixed it, but verify a common symptom)
if ($txt -match 'takeout_service_level\s*:\s*.+\r?\n\s*vendor_id\s*:') {
  # ok, means comma probably present or next line begins; we can't perfectly parse TS here but this catches the previous error pattern.
  # do nothing
}

Set-Content -Path $file -Value $txt -Encoding UTF8
Write-Host "[DONE] Dispatch bookings route patched for TAKEOUT Regular/Express + schema-safe insert." -ForegroundColor Green
Write-Host "Now run: npm run dev (or restart dev server) and try Create again on /dispatch." -ForegroundColor Cyan
