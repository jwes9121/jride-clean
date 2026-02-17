# PATCH-JRIDE_LIVETRIPS_MAP_TRIPDETAILS_V1_PS5SAFE.ps1
param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

function WriteUtf8NoBom([string]$Path, [string]$Content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

Info "== JRIDE Patch: LiveTrips Map Trip Details + booking_code id (V1 / PS5-safe) =="
Info "Root: $ProjRoot"

$bakDir = Join-Path $ProjRoot "_patch_bak"
if (!(Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

# --- Find LiveTripsClient.tsx that fetches /api/admin/livetrips/page-data ---
$clientCandidates = Get-ChildItem -LiteralPath $ProjRoot -Recurse -File -Filter "LiveTripsClient.tsx" -ErrorAction SilentlyContinue
$client = $null
foreach ($c in $clientCandidates) {
  $txt = Get-Content -LiteralPath $c.FullName -Raw -ErrorAction SilentlyContinue
  if ($txt -and $txt -match "/api/admin/livetrips/page-data") { $client = $c.FullName; break }
}
if (!$client) { Fail "[FAIL] Could not find LiveTripsClient.tsx that calls /api/admin/livetrips/page-data" }

Info "LiveTripsClient: $client"
$bak1 = Join-Path $bakDir ("LiveTripsClient.tsx.bak.LIVETRIPS_V1.$ts")
Copy-Item -LiteralPath $client -Destination $bak1 -Force
Ok "Backup: $bak1"

$src1 = Get-Content -LiteralPath $client -Raw -ErrorAction Stop

# Patch: normalize coords + passenger_name inside __normTrips map in loadPage()
# Locate the existing __normTrips mapping object and add fields (idempotent if not already present)
$needleA = 'const __normTrips = Array\.isArray\(__rawTrips\)\s*\r?\n\s*\?\s*__rawTrips\.map\(\(t: any\) => \(\{\s*'
if ($src1 -notmatch $needleA) {
  Fail "[FAIL] Could not locate __normTrips map block in loadPage() (STEP5D_LOADPAGE_EMERGENCY)."
}

# Insert after "...spread t," inside that object.
# We will replace the first occurrence of "{`n          ...t," with one that also sets normalized fields.
$patternSpread = '(?s)__rawTrips\.map\(\(t: any\) => \(\{\s*\r?\n\s*\.\.\.t,\s*'
if ($src1 -notmatch $patternSpread) {
  Fail "[FAIL] Could not find spread insertion point (...t,) inside __normTrips."
}

$insertNorm = @'
__rawTrips.map((t: any) => ({
          ...t,

          // ===== JRIDE_NORM_TRIP_FIELDS_BEGIN =====
          booking_code: (t?.booking_code ?? t?.bookingCode ?? null),
          passenger_name: (t?.passenger_name ?? t?.passengerName ?? t?.passenger ?? null),

          pickup_lat: (t?.pickup_lat ?? t?.pickupLat ?? t?.from_lat ?? t?.fromLat ?? t?.origin_lat ?? t?.originLat ?? null),
          pickup_lng: (t?.pickup_lng ?? t?.pickupLng ?? t?.from_lng ?? t?.fromLng ?? t?.origin_lng ?? t?.originLng ?? null),

          dropoff_lat: (t?.dropoff_lat ?? t?.dropoffLat ?? t?.to_lat ?? t?.toLat ?? t?.dest_lat ?? t?.destLat ?? t?.destination_lat ?? t?.destinationLat ?? null),
          dropoff_lng: (t?.dropoff_lng ?? t?.dropoffLng ?? t?.to_lng ?? t?.toLng ?? t?.dest_lng ?? t?.destLng ?? t?.destination_lng ?? t?.destinationLng ?? null),
          // ===== JRIDE_NORM_TRIP_FIELDS_END =====

'@

# Only apply if our marker anchors aren't present
if ($src1 -notmatch "JRIDE_NORM_TRIP_FIELDS_BEGIN") {
  $src1 = [System.Text.RegularExpressions.Regex]::Replace($src1, $patternSpread, $insertNorm, 1)
  Ok "[OK] Injected trip field normalization into LiveTripsClient.tsx"
} else {
  Info "[SKIP] LiveTripsClient.tsx already contains JRIDE_NORM_TRIP_FIELDS_BEGIN"
}

WriteUtf8NoBom -Path $client -Content $src1
Ok "[OK] Wrote: $client"

# --- Find components/LiveTripsMap.tsx ---
$mapCandidates = Get-ChildItem -LiteralPath $ProjRoot -Recurse -File -Filter "LiveTripsMap.tsx" -ErrorAction SilentlyContinue
$map = $null
foreach ($m in $mapCandidates) {
  $txt = Get-Content -LiteralPath $m.FullName -Raw -ErrorAction SilentlyContinue
  if ($txt -and $txt -match "Driver live overview" -and $txt -match "selectedOverview") { $map = $m.FullName; break }
}
if (!$map) { Fail "[FAIL] Could not find the correct components/LiveTripsMap.tsx (selectedOverview + Driver live overview)." }

Info "LiveTripsMap: $map"
$bak2 = Join-Path $bakDir ("LiveTripsMap.tsx.bak.LIVETRIPS_V1.$ts")
Copy-Item -LiteralPath $map -Destination $bak2 -Force
Ok "Backup: $bak2"

$src2 = Get-Content -LiteralPath $map -Raw -ErrorAction Stop

# 1) Fix id derivations to include booking_code
# Replace raw.id ?? raw.bookingCode ?? i  -> raw.id ?? raw.bookingCode ?? raw.booking_code ?? i
$src2 = $src2 -replace 'raw\.id\s*\?\?\s*raw\.bookingCode\s*\?\?\s*i', 'raw.id ?? raw.bookingCode ?? raw.booking_code ?? i'

# Replace (t as any).id ?? (t as any).bookingCode ?? idx -> include booking_code
$src2 = $src2 -replace '\(t as any\)\.id\s*\?\?\s*\(t as any\)\.bookingCode\s*\?\?\s*idx', '(t as any).id ?? (t as any).bookingCode ?? (t as any).booking_code ?? idx'

# Replace tRaw.id ?? tRaw.bookingCode ?? "" -> include booking_code
$src2 = $src2 -replace 'tRaw\.id\s*\?\?\s*tRaw\.bookingCode\s*\?\?\s*""', 'tRaw.id ?? tRaw.bookingCode ?? tRaw.booking_code ?? ""'

# Replace String(t.id ?? t.bookingCode ?? "") -> include booking_code
$src2 = $src2 -replace 'String\(t\.id\s*\?\?\s*t\.bookingCode\s*\?\?\s*""\)', 'String(t.id ?? t.bookingCode ?? (t as any).booking_code ?? "")'

# Replace String(selectedTrip.id ?? selectedTrip.bookingCode ?? "") -> include booking_code
$src2 = $src2 -replace 'String\(selectedTrip\.id\s*\?\?\s*selectedTrip\.bookingCode\s*\?\?\s*""\)', 'String(selectedTrip.id ?? selectedTrip.bookingCode ?? (selectedTrip as any).booking_code ?? "")'

# bookingCode fallback: selectedTrip.bookingCode ?? id -> include booking_code
$src2 = $src2 -replace 'selectedTrip\.bookingCode\s*\?\?\s*id', 'selectedTrip.bookingCode ?? (selectedTrip as any).booking_code ?? id'

# 2) Add passenger + coords rows in the selectedOverview overlay
# Insert after the existing "Zone" row block (safe anchor insert)
if ($src2 -notmatch "JRIDE_SELECTED_DETAILS_ROWS_BEGIN") {

  $insertAfter = '(?s)(<div className="flex justify-between">\s*\r?\n\s*<span className="text-slate-500">Zone</span>\s*\r?\n\s*<span className="font-medium">\s*\r?\n\s*\{selectedOverview\.zoneLabel\}\s*\r?\n\s*</span>\s*\r?\n\s*</div>)'

  if ($src2 -notmatch $insertAfter) {
    Fail "[FAIL] Could not locate Zone row block to inject passenger/coords rows."
  }

  $extraRows = @'
$1

              {/* ===== JRIDE_SELECTED_DETAILS_ROWS_BEGIN ===== */}
              <div className="flex justify-between">
                <span className="text-slate-500">Passenger</span>
                <span className="font-medium">
                  {selectedTrip?.passenger_name ??
                    (selectedTrip as any)?.passengerName ??
                    "—"}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">Pickup</span>
                <span className="font-medium">
                  {(() => {
                    try {
                      const p = (selectedTrip as any)
                        ? ([
                            (selectedTrip as any).pickup_lng ?? (selectedTrip as any).from_lng ?? null,
                            (selectedTrip as any).pickup_lat ?? (selectedTrip as any).from_lat ?? null,
                          ] as any)
                        : null;
                      const lng = Number(p?.[0]);
                      const lat = Number(p?.[1]);
                      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return "—";
                      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
                    } catch { return "—"; }
                  })()}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">Dropoff</span>
                <span className="font-medium">
                  {(() => {
                    try {
                      const d = (selectedTrip as any)
                        ? ([
                            (selectedTrip as any).dropoff_lng ?? (selectedTrip as any).to_lng ?? null,
                            (selectedTrip as any).dropoff_lat ?? (selectedTrip as any).to_lat ?? null,
                          ] as any)
                        : null;
                      const lng = Number(d?.[0]);
                      const lat = Number(d?.[1]);
                      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return "—";
                      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
                    } catch { return "—"; }
                  })()}
                </span>
              </div>
              {/* ===== JRIDE_SELECTED_DETAILS_ROWS_END ===== */}
'@

  $src2 = [System.Text.RegularExpressions.Regex]::Replace($src2, $insertAfter, $extraRows, 1)
  Ok "[OK] Injected passenger + pickup/dropoff lat/lng rows into overlay"
} else {
  Info "[SKIP] LiveTripsMap.tsx already contains JRIDE_SELECTED_DETAILS_ROWS_BEGIN"
}

WriteUtf8NoBom -Path $map -Content $src2
Ok "[OK] Wrote: $map"
Ok "[OK] Done."
