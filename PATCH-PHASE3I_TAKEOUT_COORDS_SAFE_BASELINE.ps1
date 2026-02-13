# PATCH-PHASE3I_TAKEOUT_COORDS_SAFE_BASELINE.ps1
# ASCII-safe. Creates .bak timestamp backups. PowerShell-only.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$root = (Get-Location).Path

# Target (adjust only if your repo differs)
$target = Join-Path $root "app\api\vendor-orders\route.ts"
if (!(Test-Path $target)) {
  Fail "Missing: $target`nIf your vendor-orders API route is in a different path, rename $target in this script then re-run."
}

$src = Get-Content -Raw -Encoding UTF8 $target

if ($src -notmatch "export\s+async\s+function\s+POST\s*\(") {
  Fail "Could not find 'export async function POST(' in $target.`nPaste the first ~260 lines of this file in chat so I can anchor correctly."
}

# Anchor where we insert: right after request json parse (common patterns)
# We handle a few variants.
$insertAnchor = $null
$patterns = @(
  '(?s)(const\s+body\s*=\s*await\s+req\.json\(\)\s*;)',
  '(?s)(const\s+payload\s*=\s*await\s+req\.json\(\)\s*;)',
  '(?s)(const\s+json\s*=\s*await\s+req\.json\(\)\s*;)'
)

foreach ($p in $patterns) {
  $m = [regex]::Match($src, $p)
  if ($m.Success) { $insertAnchor = $m.Value; break }
}
if (!$insertAnchor) {
  Fail "Could not find a recognizable req.json() parse anchor in POST() in $target.`nPaste the first ~260 lines of POST() and I will generate a precise patch."
}

# Ensure helpers exist (your route.ts already includes these in your upload)
if ($src -notmatch "fetchVendorCoordsAndTown" -or $src -notmatch "fetchAddressCoords") {
  Warn "Coords helper functions not detected (fetchVendorCoordsAndTown/fetchAddressCoords)."
  Warn "PHASE3I expects those helpers to exist. If this file is missing them, upload your app/api/vendor-orders/route.ts."
}

# Insert block (idempotent)
if ($src -match "PHASE3I_COORDS_RESOLVE_START") {
  Ok "PHASE3I block already present. No changes made."
} else {

$block = @'
/* PHASE3I_COORDS_RESOLVE_START
   Resolve pickup/dropoff coords safely for takeout (no Mapbox UI changes).
   - pickup: vendor_accounts coords (fallback: any coords passed in body)
   - dropoff: passenger_addresses coords (fallback: Mapbox geocode if token exists)
   - town/zone: safe derive
*/
const _b: any = (typeof body !== "undefined" ? body : (typeof payload !== "undefined" ? payload : (typeof json !== "undefined" ? json : {}))) || {};
const device_key = String(_b.device_key ?? _b.deviceKey ?? "").trim();
const vendor_id  = String(_b.vendor_id  ?? _b.vendorId  ?? "").trim();
const address_id = String(_b.address_id ?? _b.addressId ?? "").trim() || null;

const to_label = String(_b.to_label ?? _b.toLabel ?? _b.dropoff_label ?? _b.dropoffLabel ?? "").trim() || null;

// Optional body-provided coords (do NOT trust blindly; normalizeLL handles 0/NaN)
const bodyPickup = (typeof pickLatLng === "function") ? pickLatLng(_b.pickup || _b.vendor || _b) : { lat: null, lng: null };
const bodyDrop   = (typeof pickLatLng === "function") ? pickLatLng(_b.dropoff || _b.to || _b) : { lat: null, lng: null };

// Use admin client when available in this route (common name: admin)
let _adminAny: any = (typeof admin !== "undefined" ? (admin as any) : null);

// Fallback: if your route uses a different admin client variable name, keep it as-is and this stays null.
// In that case, coords resolve will still attempt from body, then fail-safe if missing.

// 1) pickup coords from vendor_accounts (preferred)
let pickupLL = bodyPickup;
let vendorTown: string | null = null;
if (_adminAny && vendor_id && typeof fetchVendorCoordsAndTown === "function") {
  const got = await fetchVendorCoordsAndTown(_adminAny, vendor_id);
  vendorTown = got?.town ?? null;
  if (got?.ll?.lat != null && got?.ll?.lng != null) pickupLL = got.ll;
}

// 2) dropoff coords from passenger_addresses / Mapbox geocode (preferred)
let dropLL = bodyDrop;
if (_adminAny && device_key && typeof fetchAddressCoords === "function") {
  const got = await fetchAddressCoords(_adminAny, device_key, address_id, to_label);
  if (got?.lat != null && got?.lng != null) dropLL = got;
}

// 3) derive town/zone safely (no hard dependency on any single field)
let town: string | null =
  String(_b.town ?? _b.municipality ?? _b.lgu ?? "").trim() || null;

if (!town) town = vendorTown;
if (!town && typeof inferTownFromLabel === "function") town = inferTownFromLabel(to_label);
if (!town && typeof deriveTownFromLatLng === "function") town = deriveTownFromLatLng(dropLL?.lat ?? null, dropLL?.lng ?? null);

let zone: string | null = null;
if (typeof deriveZoneFromTown === "function") zone = deriveZoneFromTown(town);
else zone = town;

// If we are creating a takeout booking/order, coords must be valid.
// Fail safe (prevents PROBLEM noise and prevents dispatch-visible broken records)
const coordsOk = (pickupLL?.lat != null && pickupLL?.lng != null && dropLL?.lat != null && dropLL?.lng != null);
if (!coordsOk) {
  throw new Error("TAKEOUT_COORDS_MISSING: pickup/dropoff coordinates could not be resolved. Check vendor_accounts + passenger_addresses coords, or Mapbox token fallback.");
}
/* PHASE3I_COORDS_RESOLVE_END */
'@

  # Insert immediately after req.json() statement
  $src2 = $src -replace [regex]::Escape($insertAnchor), ($insertAnchor + "`r`n`r`n" + $block)

  # Next: ensure the computed values are used in the booking insert/update.
  # We do best-effort injection: replace occurrences of pickup_lat/dropoff_lat assignments if present,
  # otherwise we append fields near dropoff_label / pickup_label if found.

  if ($src2 -notmatch "pickup_lat" -and $src2 -match "pickup_label") {
    $src2 = $src2 -replace '(?s)(pickup_label\s*:\s*[^,\r\n]+,\s*)', ('$1' + "`r`n        pickup_lat: (pickupLL as any).lat,`r`n        pickup_lng: (pickupLL as any).lng,`r`n")
  }
  if ($src2 -notmatch "dropoff_lat" -and $src2 -match "dropoff_label") {
    $src2 = $src2 -replace '(?s)(dropoff_label\s*:\s*[^,\r\n]+,\s*)', ('$1' + "`r`n        dropoff_lat: (dropLL as any).lat,`r`n        dropoff_lng: (dropLL as any).lng,`r`n")
  }

  # Town/zone
  if ($src2 -notmatch "town\s*:" -and $src2 -match "service_type") {
    $src2 = $src2 -replace '(?s)(service_type\s*:\s*[^,\r\n]+,\s*)', ('$1' + "`r`n        town: town,`r`n        zone: zone,`r`n")
  }

  # Backup + write
  $bak = "$target.bak.$ts"
  Copy-Item -Force $target $bak
  Ok "Backup: $bak"

  Set-Content -Encoding UTF8 -NoNewline -Path $target -Value $src2
  Ok "Patched: $target"
}

Ok "PHASE3I patch complete."
