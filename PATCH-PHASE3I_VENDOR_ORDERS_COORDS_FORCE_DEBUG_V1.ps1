# PATCH-PHASE3I_VENDOR_ORDERS_COORDS_FORCE_DEBUG_V1.ps1
# - Removes silent coord force updates
# - Adds one force update with select+single and error surfacing
# - Prevents hydrate block from overwriting coords
# - UTF-8 no BOM write (no Set-Content -Encoding)

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Ok($m){ Write-Host $m -ForegroundColor Green }

$root = (Get-Location).Path
$target = Join-Path $root "app\api\vendor-orders\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "[OK] Backup: $bak"

$src = Get-Content $target -Raw

# 1) Remove BOTH existing force blocks (they were swallowing errors / duplicated)
$src2 = $src
$src2 = [regex]::Replace($src2, '(?s)\n\s*//\s*PHASE3I_FORCE_POSTCREATE_COORDS.*?//\s*PHASE3I_FORCE_POSTCREATE_COORDS_END\s*\n', "`n")
$src2 = [regex]::Replace($src2, '(?s)\n\s*//\s*PHASE3I_AFTER_INSERT_FORCE_UPDATE.*?//\s*PHASE3I_AFTER_INSERT_FORCE_UPDATE_END\s*\n', "`n")

if ($src2 -eq $src) {
  Info "[INFO] No existing PHASE3I force blocks removed (maybe already removed)."
}

# 2) Insert ONE authoritative force-update AFTER bookingId is validated
$needle = 'if\s*\(\s*!bookingId\s*\)\s*return\s+json\('
if (-not [regex]::IsMatch($src2, $needle)) {
  Fail "Could not locate the bookingId validation line: if (!bookingId) return json(...). Paste that section if needed."
}

$insertion = @"
  // PHASE3I_FORCE_COORDS_AUTHORITATIVE_START
  // DB appears to default coords to 0/0 on INSERT for takeout in some cases.
  // Force-correct via UPDATE immediately and surface any error (do NOT swallow).
  const forcePayload: Record<string, any> = {
    vendor_id,
    pickup_lat: (pickupLL as any)?.lat ?? null,
    pickup_lng: (pickupLL as any)?.lng ?? null,
    dropoff_lat: (dropoffLL as any)?.lat ?? null,
    dropoff_lng: (dropoffLL as any)?.lng ?? null,
    town: (typeof derivedTown !== "undefined" ? derivedTown : null),
  };

  const forceRes = await admin
    .from("bookings")
    .update(forcePayload)
    .eq("id", bookingId)
    .select("id,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,town")
    .single();

  if (forceRes.error) {
    return json(500, {
      ok: false,
      error: "FORCE_UPDATE_FAILED",
      message: forceRes.error.message,
      forcePayload,
    });
  }
  // PHASE3I_FORCE_COORDS_AUTHORITATIVE_END

"@

# Insert right AFTER the bookingId check line (keep behavior stable)
$src3 = [regex]::Replace(
  $src2,
  "(?m)^(\s*if\s*\(\s*!bookingId\s*\)\s*return\s+json\([^\r\n]*\)\s*;\s*)$",
  "`$1`r`n$insertion",
  1
)

if ($src3 -eq $src2) {
  Fail "Failed to insert authoritative force block (pattern mismatch). Paste the bookingId check line block."
}

# 3) Prevent later hydrate updatePayload from overwriting coords
# Remove these 4 lines if they exist inside updatePayload object:
$src4 = $src3
$src4 = [regex]::Replace($src4, "(?m)^\s*pickup_lat\s*,\s*\r?\n", "")
$src4 = [regex]::Replace($src4, "(?m)^\s*pickup_lng\s*,\s*\r?\n", "")
$src4 = [regex]::Replace($src4, "(?m)^\s*dropoff_lat\s*,\s*\r?\n", "")
$src4 = [regex]::Replace($src4, "(?m)^\s*dropoff_lng\s*,\s*\r?\n", "")

# Also remove the literal properties if written as "pickup_lat," etc already handled; if they are "pickup_lat," as variables, done.

# Write UTF-8 (no BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $src4, $utf8NoBom)

Ok "[OK] Patched: $target"
Info "[INFO] Next: run build. If FORCE_UPDATE_FAILED appears, paste the returned message + forcePayload."
