# PATCH-PHASE3I_VENDOR_ORDERS_COORDS_SOURCE_FIX.ps1
# Fix createPayload dropoff coords to use dropoffLL (normalized) instead of dropLL.
# Fix hydrate vendor_accounts lookup (no vendor_id col): try id/email/display_name/location_label.
# Simplify passenger_addresses coords pick to lat/lng only (schema accurate).
# ASCII-safe; creates .bak backup.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$target = Join-Path (Get-Location).Path "app\api\vendor-orders\route.ts"
if (!(Test-Path $target)) { Fail "Missing: $target" }

$src = Get-Content -Raw -Encoding UTF8 $target
$orig = $src

# 1) Fix createPayload dropoff coords: dropLL -> dropoffLL
# Anchor: the createPayload block contains "dropoff_lat: (dropLL as any).lat,"
$src = $src -replace "(?m)^\s*dropoff_lat:\s*\(dropLL\s+as\s+any\)\.lat,\s*$", "        dropoff_lat: (dropoffLL as any).lat,"
$src = $src -replace "(?m)^\s*dropoff_lng:\s*\(dropLL\s+as\s+any\)\.lng,\s*$", "        dropoff_lng: (dropoffLL as any).lng,"

# 2) Fix hydrate vendorMeta lookup candidates (remove vendor_id, add email/display_name/location_label)
# Replace the exact 3-line OR block if present
$patternVendorMeta = '(?s)\(await\s+tryFetchRowById\(admin,\s*"vendor_accounts",\s*"id",\s*vendor_id\)\)\s*\|\|\s*\(await\s+tryFetchRowById\(admin,\s*"vendor_accounts",\s*"vendor_id",\s*vendor_id\)\)\s*\|\|\s*null'
if ($src -match $patternVendorMeta) {
  $replacementVendorMeta = @'
(await tryFetchRowById(admin, "vendor_accounts", "id", vendor_id)) ||
      (await tryFetchRowById(admin, "vendor_accounts", "email", vendor_id)) ||
      (await tryFetchRowById(admin, "vendor_accounts", "display_name", vendor_id)) ||
      (await tryFetchRowById(admin, "vendor_accounts", "location_label", vendor_id)) ||
      null
'@
  $src = [regex]::Replace($src, $patternVendorMeta, $replacementVendorMeta, 1)
} else {
  # If not found, still attempt a smaller replace for the vendor_id candidate line
  $src = $src -replace '(?m)^\s*\(await\s+tryFetchRowById\(admin,\s*"vendor_accounts",\s*"vendor_id",\s*vendor_id\)\)\s*\|\|\s*$', ""
}

# 3) Simplify address lat/lng pick to schema-accurate (lat/lng only)
# Replace the two multi-fallback lines if present
$src = $src -replace "(?m)^\s*isFiniteNum\(addr\?\.(dropoff_lat)\)\s*\?\?\s*isFiniteNum\(addr\?\.(lat)\)\s*\?\?\s*isFiniteNum\(addr\?\.(latitude)\)\s*\?\?\s*isFiniteNum\(addr\?\.(location_lat)\)\s*\?\?\s*null;\s*$", "      isFiniteNum(addr?.lat) ?? null;"
$src = $src -replace "(?m)^\s*isFiniteNum\(addr\?\.(dropoff_lng)\)\s*\?\?\s*isFiniteNum\(addr\?\.(lng)\)\s*\?\?\s*isFiniteNum\(addr\?\.(longitude)\)\s*\?\?\s*isFiniteNum\(addr\?\.(location_lng)\)\s*\?\?\s*null;\s*$", "      isFiniteNum(addr?.lng) ?? null;"

if ($src -eq $orig) {
  Fail "No changes were applied. Paste the createPayload coord lines and the vendorMeta + aLat/aLng lines so I can re-anchor precisely."
}

$bak = "$target.bak.$ts"
Copy-Item -Force $target $bak
Ok "Backup: $bak"

Set-Content -Encoding UTF8 -NoNewline -Path $target -Value $src
Ok "Patched: $target"
Ok "Fixed dropoff source (dropoffLL), fixed vendor_accounts hydrate lookup, simplified passenger_addresses lat/lng pick."
