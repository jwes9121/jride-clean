# PATCH-JRIDE_PHASE7D_STATUSPAYLOAD_AND_MARKER_FALLBACK.ps1
# Frontend-only:
# 1) Fix status/assign payload keys (booking_code/driver_id) while keeping bookingCode/driverId for compatibility
# 2) Add fallback driver marker when no driver GPS exists (use pickup/dropoff)

$ErrorActionPreference = "Stop"

function Fail($m){ throw "[FAIL] $m" }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$client = "app\admin\livetrips\LiveTripsClient.tsx"
$map    = "app\admin\livetrips\components\LiveTripsMap.tsx"

foreach($p in @($client,$map)){
  if(!(Test-Path $p)){ Fail "Missing file: $p (run from repo root)" }
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"

# -------------------- Patch LiveTripsClient.tsx --------------------
Copy-Item $client "$client.bak.$stamp" -Force
Ok "Backup: $client.bak.$stamp"

$txt = Get-Content $client -Raw

$before1 = 'await postJson("/api/dispatch/assign", { bookingCode, driverId });'
$after1  = 'await postJson("/api/dispatch/assign", { booking_code: bookingCode, bookingCode, driver_id: driverId, driverId });'

if($txt.Contains($before1)){
  $txt = $txt.Replace($before1, $after1)
  Ok "Patched assignDriver payload keys."
} else {
  Fail "LiveTripsClient: could not find exact assign payload line."
}

$before2 = 'await postJson("/api/dispatch/status", { bookingCode, status });'
$after2  = 'await postJson("/api/dispatch/status", { booking_code: bookingCode, bookingCode, status });'

if($txt.Contains($before2)){
  $txt = $txt.Replace($before2, $after2)
  Ok "Patched updateTripStatus payload keys."
} else {
  Fail "LiveTripsClient: could not find exact status payload line."
}

Set-Content -LiteralPath $client -Value $txt -Encoding UTF8
Ok "Wrote: $client"

# -------------------- Patch LiveTripsMap.tsx --------------------
Copy-Item $map "$map.bak.$stamp" -Force
Ok "Backup: $map.bak.$stamp"

$mtxt = Get-Content $map -Raw

# Replace the 4-line block so pickup/drop exist before fallback marker logic
$blockBefore = @"
      const driverReal = getDriverReal(raw);
      const driverDisplay = getDriverDisplay(driverReal);
      const pickup = getPickup(raw);
      const drop = getDropoff(raw);
"@

$blockAfter = @"
      const driverReal = getDriverReal(raw);
      const pickup = getPickup(raw);
      const drop = getDropoff(raw);

      // Fallback marker when driver GPS is missing:
      // show a driver marker at pickup (or dropoff) for active statuses so dispatcher sees *something*.
      let driverDisplay = getDriverDisplay(driverReal);
      const statusNorm = String(raw.status ?? "").trim().toLowerCase();
      if (!driverDisplay && (statusNorm === "assigned" || statusNorm === "on_the_way" || statusNorm === "on_trip")) {
        const fb = pickup ?? drop ?? null;
        if (fb) driverDisplay = fb;
      }
"@

if($mtxt.Contains($blockBefore)){
  $mtxt = $mtxt.Replace($blockBefore, $blockAfter)
  Ok "Added fallback driver marker logic (no-GPS)."
} else {
  Fail "LiveTripsMap: could not find the exact driver/pickup/drop block to replace."
}

Set-Content -LiteralPath $map -Value $mtxt -Encoding UTF8
Ok "Wrote: $map"

Ok "Phase 7D patch applied successfully."
