# PATCH-PHASE3I_VENDOR_ORDERS_RETURN_COORDS_DEBUG.ps1
# Adds debug fields to /api/vendor-orders POST response:
# - resolved coords (from code)
# - db coords after create
# PS5.1 safe write + backup, ASCII-safe.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$target = "app\api\vendor-orders\route.ts"
if (!(Test-Path $target)) { Fail "Missing $target" }

$src = [System.IO.File]::ReadAllText((Resolve-Path $target), [System.Text.Encoding]::UTF8)

if ($src -match "PHASE3I_VENDOR_ORDERS_COORDS_DEBUG") {
  Fail "Patch already present (PHASE3I_VENDOR_ORDERS_COORDS_DEBUG)."
}

# Replace the created response block by injecting a DB re-read + debug fields.
$needle = @'
  return json(200, {
'@

$pos = $src.IndexOf($needle)
if ($pos -lt 0) { Fail "Could not find 'return json(200, {' anchor near end of POST create response." }

# We'll inject ONLY in the created response (must contain action: "created")
# Find the specific block starting at the last occurrence before end.
$last = $src.LastIndexOf($needle)
if ($last -lt 0) { Fail "Could not locate last created return json block." }

$before = $src.Substring(0, $last)
$after  = $src.Substring($last)

if ($after -notmatch 'action:\s*"created"') {
  Fail "Last return json block does not look like the created response (missing action: ""created""). Paste the bottom of POST()."
}

$inject = @'
  // PHASE3I_VENDOR_ORDERS_COORDS_DEBUG
  let coords_debug: any = null;
  try {
    const chk = await admin
      .from("bookings")
      .select("id,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,town")
      .eq("id", bookingId)
      .single();
    coords_debug = (chk && !chk.error) ? chk.data : null;
  } catch {}
  // PHASE3I_VENDOR_ORDERS_COORDS_DEBUG_END

'@

# Insert the debug read just BEFORE the return json(200, { ...created... })
$before2 = $before + $inject

# Now enhance the response by adding debug fields right after action/order_id area.
# We'll safely add 3 fields near order_id to avoid formatting sensitivities.
$after2 = $after

# Add fields after order_id: bookingId,
$after2 = $after2 -replace '(order_id:\s*bookingId,\s*)', ('$1' + "`r`n" + '    resolved_pickup: pickupLL ?? vendorLL ?? null,' + "`r`n" + '    resolved_dropoff: dropoffLL ?? dropLL ?? null,' + "`r`n" + '    db_coords: coords_debug,' + "`r`n`r`n")

if ($after2 -eq $after) { Fail "Failed to inject debug fields into created response (order_id: bookingId not found or formatting changed)." }

$src2 = $before2 + $after2

$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

[System.IO.File]::WriteAllText((Resolve-Path $target), $src2, [System.Text.Encoding]::UTF8)
Ok "Patched: $target"
Ok "Added coords debug to created response."
