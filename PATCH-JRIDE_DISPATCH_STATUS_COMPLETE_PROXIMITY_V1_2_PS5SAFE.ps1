param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "ProjRoot not found: $ProjRoot" }

$target = Join-Path $ProjRoot "app\api\dispatch\status\route.ts"
if (!(Test-Path -LiteralPath $target)) { Fail "Target not found: $target" }

Write-Host "== PATCH: dispatch/status completed proximity rule (V1.2 / PS5-safe) ==" -ForegroundColor Cyan
Write-Host "Target: $target"

# Backup
$bkDir = Join-Path $ProjRoot "_patch_bak"
if (!(Test-Path -LiteralPath $bkDir)) { New-Item -ItemType Directory -Path $bkDir | Out-Null }
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bk = Join-Path $bkDir ("dispatch-status.route.ts.bak.COMPLETE_PROXIMITY_V1_2.{0}" -f $ts)
Copy-Item -LiteralPath $target -Destination $bk -Force
Ok "Backup: $bk"

$src = Get-Content -LiteralPath $target -Raw -Encoding UTF8

# ---------- 1) Inject helpers (once) ----------
$helpersBegin = "/* JRIDE_COMPLETE_PROXIMITY_BEGIN */"
$helpersEnd   = "/* JRIDE_COMPLETE_PROXIMITY_END */"

if ($src -notmatch [regex]::Escape($helpersBegin)) {

  $helpers = @"
$helpersBegin
const JRIDE_COMPLETE_RADIUS_M = Number(process.env.JRIDE_COMPLETE_RADIUS_M ?? 250);

// Haversine distance (meters)
function jrideHaversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000; // meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function jrideGetDriverCoords(supabase: any, driverId: string): Promise<{ lat: number; lng: number } | null> {
  try {
    if (!driverId) return null;
    const { data, error } = await supabase
      .from("driver_locations")
      .select("lat,lng,updated_at")
      .eq("driver_id", driverId)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) return null;
    const row = Array.isArray(data) && data.length ? data[0] : null;
    const lat = Number(row?.lat);
    const lng = Number(row?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}
$helpersEnd

"@

  # Insert helpers right after: const ALLOWED = [...] (stable early anchor)
  $pat = "(?s)(const\s+ALLOWED\s*=\s*\[[^\]]*\]\s*as\s*const\s*;\s*)"
  if ($src -notmatch $pat) { Fail "Could not find anchor: const ALLOWED = [...] as const;" }

  $src = [regex]::Replace($src, $pat, "`$1`r`n$helpers", 1)
  Ok "Injected proximity helpers"
} else {
  Ok "Proximity helpers already present"
}

# ---------- 2) Inject runtime check before timestamps block ----------
$checkBegin = "/* JRIDE_COMPLETE_PROXIMITY_CHECK_BEGIN */"
$checkEnd   = "/* JRIDE_COMPLETE_PROXIMITY_CHECK_END */"

if ($src -notmatch [regex]::Escape($checkBegin)) {

  $checkBlock = @"
  $checkBegin
  // Completion must be destination-based, NOT polyline-based.
  // Allow complete if within radius of dropoff OR if forced.
  if (target === "completed" && !force) {
    const dLat = Number(booking?.dropoff_lat);
    const dLng = Number(booking?.dropoff_lng);

    // Prefer coords from request body if present, else driver_locations fallback.
    const bodyLat = Number(rawBody?.lat ?? rawBody?.driver_lat ?? rawBody?.driverLat);
    const bodyLng = Number(rawBody?.lng ?? rawBody?.driver_lng ?? rawBody?.driverLng);

    let curLat: number | null = null;
    let curLng: number | null = null;

    if (Number.isFinite(bodyLat) && Number.isFinite(bodyLng)) {
      curLat = bodyLat; curLng = bodyLng;
    } else {
      const dl = await jrideGetDriverCoords(supabase as any, String(booking?.driver_id ?? ""));
      if (dl) { curLat = dl.lat; curLng = dl.lng; }
    }

    if (Number.isFinite(dLat) && Number.isFinite(dLng) && Number.isFinite(curLat as any) && Number.isFinite(curLng as any)) {
      const meters = jrideHaversineMeters(curLat as any, curLng as any, dLat, dLng);
      const radius = Number.isFinite(JRIDE_COMPLETE_RADIUS_M) ? JRIDE_COMPLETE_RADIUS_M : 250;
      if (meters > radius) {
        return jsonErr("TOO_FAR_FROM_DROPOFF", "Driver too far from dropoff to complete (" + Math.round(meters) + "m, radius " + radius + "m). Use force=true to override.", 409, {
          booking_id: String(booking.id),
          booking_code: booking.booking_code ?? null,
          meters: meters,
          radius_m: radius,
          driver_lat: curLat,
          driver_lng: curLng,
          dropoff_lat: dLat,
          dropoff_lng: dLng
        });
      }
    }
  }
  $checkEnd

"@

  $anchor = "(?m)^\s*\/\/ Best-effort timestamps \+ note \(falls back to status-only if columns missing\)\s*$"
  if ($src -notmatch $anchor) { Fail "Could not find anchor: // Best-effort timestamps + note ..." }

  $src = [regex]::Replace($src, $anchor, ($checkBlock + "`r`n// Best-effort timestamps + note (falls back to status-only if columns missing)"), 1)
  Ok "Injected proximity completion check"
} else {
  Ok "Proximity completion check already present"
}

# Write back UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $src, $utf8NoBom)
Ok "Wrote patched file (UTF-8 no BOM)"

Write-Host ""
Write-Host "NEXT:" -ForegroundColor Cyan
Write-Host "  1) Set env (optional): JRIDE_COMPLETE_RADIUS_M=250 (or 300) on Vercel"
Write-Host "  2) Redeploy"
Write-Host "  3) Driver -> Complete Trip near dropoff OR use force=true for admin override"
