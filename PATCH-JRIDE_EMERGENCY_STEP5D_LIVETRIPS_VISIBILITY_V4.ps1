# PATCH-JRIDE_EMERGENCY_STEP5D_LIVETRIPS_VISIBILITY_V4.ps1
# STEP 5D: LiveTrips visibility for emergency dispatch + pickup fee/distance
# Files:
# - app/api/admin/livetrips/page-data/route.ts   (skip if already has STEP5D markers)
# - app/admin/livetrips/LiveTripsClient.tsx     (robust: loadPage() uses setAllTrips)
# Rules:
# - No manual edits
# - No Mapbox changes
# - UTF-8 no BOM
# - Safe re-run via markers

$ErrorActionPreference = "Stop"

function Backup-File($path) {
  if (!(Test-Path $path)) { throw "Missing file: $path" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak.$ts"
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Require-Anchor($txt, $needle, $path) {
  if ($txt.IndexOf($needle) -lt 0) {
    throw ("Anchor not found in {0}`n---needle---`n{1}`n------------" -f $path, $needle)
  }
}

function Insert-After($txt, $needle, $insert, $path) {
  Require-Anchor $txt $needle $path
  $p = $txt.IndexOf($needle)
  $pEnd = $p + $needle.Length
  return $txt.Substring(0, $pEnd) + $insert + $txt.Substring($pEnd)
}

function Insert-Before($txt, $needle, $insert, $path) {
  Require-Anchor $txt $needle $path
  $p = $txt.IndexOf($needle)
  return $txt.Substring(0, $p) + $insert + $txt.Substring($p)
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
$root = (Get-Location).Path

# =====================================================
# 1) API route.ts (idempotent; should already be done)
# =====================================================
$routePath = Join-Path $root "app\api\admin\livetrips\page-data\route.ts"
if (Test-Path $routePath) {
  Backup-File $routePath
  $routeTxt = Get-Content -LiteralPath $routePath -Raw

  # If already patched in prior runs, skip cleanly.
  if ($routeTxt.IndexOf("STEP5D_TRIPSOUT_EMERGENCY") -ge 0 -and $routeTxt.IndexOf("STEP5D_FALLBACK_EMERGENCY") -ge 0) {
    Write-Host "[SKIP] route.ts already has STEP5D markers"
  } else {
    # Minimal safe injection: only if anchors exist
    $fallbackNeedle = "            __fallback_injected: true,"
    $tripsOutNeedle = "  const tripsOut = (Array.isArray(trips) ? trips : []).map((t: any) => ({"
    Require-Anchor $routeTxt $fallbackNeedle $routePath
    Require-Anchor $routeTxt $tripsOutNeedle $routePath

    if ($routeTxt.IndexOf("STEP5D_FALLBACK_EMERGENCY") -lt 0) {
      $fallbackInsert = @'
            // ===== STEP5D_FALLBACK_EMERGENCY =====
            is_emergency: (b as any)?.is_emergency ?? (b as any)?.isEmergency ?? null,
            pickup_distance_km:
              (b as any)?.pickup_distance_km ??
              (b as any)?.pickupDistanceKm ??
              (b as any)?.pickup_distance ??
              (b as any)?.pickupDistance ??
              null,
            emergency_pickup_fee_php:
              (b as any)?.emergency_pickup_fee_php ??
              (b as any)?.emergencyPickupFeePhp ??
              (b as any)?.pickup_distance_fee ??
              (b as any)?.pickup_distance_fee_php ??
              null,
            // ===== END STEP5D_FALLBACK_EMERGENCY =====

'@
      $routeTxt = Insert-Before $routeTxt $fallbackNeedle $fallbackInsert $routePath
      Write-Host "[OK] route.ts fallback emergency fields added"
    }

    if ($routeTxt.IndexOf("STEP5D_TRIPSOUT_EMERGENCY") -lt 0) {
      $tripsOutInsert = @'

    // ===== STEP5D_TRIPSOUT_EMERGENCY =====
    is_emergency: Boolean(
      (t as any)?.is_emergency ??
      (t as any)?.isEmergency ??
      false
    ),
    pickup_distance_km:
      (t as any)?.pickup_distance_km ??
      (t as any)?.pickupDistanceKm ??
      (t as any)?.pickup_distance ??
      (t as any)?.pickupDistance ??
      (t as any)?.driver_to_pickup_km ??
      null,
    emergency_pickup_fee_php:
      (t as any)?.emergency_pickup_fee_php ??
      (t as any)?.emergencyPickupFeePhp ??
      (t as any)?.pickup_distance_fee ??
      (t as any)?.pickup_distance_fee_php ??
      null,
    // ===== END STEP5D_TRIPSOUT_EMERGENCY =====

'@
      $routeTxt = Insert-After $routeTxt $tripsOutNeedle $tripsOutInsert $routePath
      Write-Host "[OK] route.ts tripsOut emergency normalization added"
    }

    [System.IO.File]::WriteAllText($routePath, $routeTxt, $utf8)
    Write-Host "[DONE] Patched: $routePath"
  }
} else {
  Write-Host "[SKIP] route.ts not found (path changed?)"
}

# =====================================================
# 2) UI LiveTripsClient.tsx (robust)
# =====================================================
$uiPath = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
Backup-File $uiPath
$uiTxt = Get-Content -LiteralPath $uiPath -Raw

# --- 2A) Extend TripRow type (idempotent marker)
if ($uiTxt.IndexOf("STEP5D_TRIPROW_EMERGENCY") -lt 0) {
  $tripRowNeedle = "type TripRow = {"
  Require-Anchor $uiTxt $tripRowNeedle $uiPath

  # Insert after first "status?: string | null;" that occurs after TripRow block begins
  $tripRowPos = $uiTxt.IndexOf($tripRowNeedle)
  $statusNeedle = '  status?: string | null;'
  $statusPos = $uiTxt.IndexOf($statusNeedle, $tripRowPos)
  if ($statusPos -lt 0) { throw "Could not find TripRow status line after TripRow start." }
  $statusEnd = $statusPos + $statusNeedle.Length

  $typeInsert = @'

  // ===== STEP5D_TRIPROW_EMERGENCY =====
  is_emergency?: boolean | null;
  pickup_distance_km?: number | null;
  emergency_pickup_fee_php?: number | null;
  // ===== END STEP5D_TRIPROW_EMERGENCY =====

'@
  $uiTxt = $uiTxt.Substring(0, $statusEnd) + $typeInsert + $uiTxt.Substring($statusEnd)
  Write-Host "[OK] LiveTripsClient TripRow extended (STEP5D)"
} else {
  Write-Host "[SKIP] LiveTripsClient TripRow already extended"
}

# --- 2B) Normalize in loadPage() by replacing setAllTrips(...) line
if ($uiTxt.IndexOf("STEP5D_LOADPAGE_EMERGENCY") -lt 0) {
  $setAllTripsNeedle = '    setAllTrips((j.trips || j.bookings || j.data || []) as any[]);'
  Require-Anchor $uiTxt $setAllTripsNeedle $uiPath

  $replacement = @'
    // ===== STEP5D_LOADPAGE_EMERGENCY =====
    const __rawTrips = (j.trips || j.bookings || j.data || []) as any[];
    const __normTrips = Array.isArray(__rawTrips)
      ? __rawTrips.map((t: any) => ({
          ...t,
          is_emergency: Boolean(t?.is_emergency ?? t?.isEmergency ?? t?.emergency ?? false),
          pickup_distance_km:
            t?.pickup_distance_km ??
            t?.pickupDistanceKm ??
            t?.pickup_distance ??
            t?.pickupDistance ??
            t?.driver_to_pickup_km ??
            null,
          emergency_pickup_fee_php:
            t?.emergency_pickup_fee_php ??
            t?.emergencyPickupFeePhp ??
            t?.pickup_distance_fee ??
            t?.pickup_distance_fee_php ??
            null,
        }))
      : [];
    setAllTrips(__normTrips as any[]);
    // ===== END STEP5D_LOADPAGE_EMERGENCY =====
'@

  $uiTxt = $uiTxt.Replace($setAllTripsNeedle, $replacement)
  Write-Host "[OK] LiveTripsClient loadPage emergency normalization inserted"
} else {
  Write-Host "[SKIP] LiveTripsClient loadPage normalization already present"
}

# --- 2C) Insert badge + fee text near PROBLEM badge block (stable anchor in your file)
if ($uiTxt.IndexOf("JRIDE_STEP5D_EMERGENCY_BADGE") -lt 0) {
  $problemNeedle = "PROBLEM"
  $pProb = $uiTxt.IndexOf($problemNeedle)
  if ($pProb -lt 0) { throw "Could not find 'PROBLEM' anchor in LiveTripsClient table rendering." }

  # Insert before the next </td> after PROBLEM occurrence
  $tdClose = $uiTxt.IndexOf("</td>", $pProb)
  if ($tdClose -lt 0) { throw "Could not find </td> after PROBLEM anchor." }

  $badge = @'

                          {/* ===== JRIDE_STEP5D_EMERGENCY_BADGE ===== */}
                          {(Boolean((t as any).is_emergency)) ? (
                            <span className="ml-2 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                              🚨 EMERGENCY
                            </span>
                          ) : null}

                          {(Number((t as any).emergency_pickup_fee_php) > 0) ? (
                            <span className="ml-2 text-xs text-amber-800">
                              +₱{Math.round(Number((t as any).emergency_pickup_fee_php))} pickup fee
                              {Number.isFinite(Number((t as any).pickup_distance_km)) ? ` (${Number((t as any).pickup_distance_km).toFixed(2)} km)` : ""}
                            </span>
                          ) : (Number.isFinite(Number((t as any).pickup_distance_km)) ? (
                            <span className="ml-2 text-xs text-gray-500">
                              ({Number((t as any).pickup_distance_km).toFixed(2)} km)
                            </span>
                          ) : null)}
                          {/* ===== END JRIDE_STEP5D_EMERGENCY_BADGE ===== */}

'@

  $uiTxt = $uiTxt.Substring(0, $tdClose) + $badge + $uiTxt.Substring($tdClose)
  Write-Host "[OK] LiveTripsClient emergency badge + fee text inserted"
} else {
  Write-Host "[SKIP] LiveTripsClient emergency badge already present"
}

[System.IO.File]::WriteAllText($uiPath, $uiTxt, $utf8)
Write-Host "[DONE] Patched: $uiPath"

Write-Host ""
Write-Host "NEXT: npm run build"
