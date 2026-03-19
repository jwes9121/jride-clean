# PATCH-JRIDE_DISPATCH_ASSIGN_ENFORCE_LIVE_DRIVER_ELIGIBILITY_V3_PS5SAFE.ps1
param(
  [Parameter(Mandatory = $true)]
  [string]$WebRoot
)

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }

if (-not (Test-Path -LiteralPath $WebRoot)) {
  Fail "WebRoot not found: $WebRoot"
}

$target = Join-Path $WebRoot "app\api\dispatch\assign\route.ts"
if (-not (Test-Path -LiteralPath $target)) {
  Fail "Target file not found: $target"
}

$content = Get-Content -LiteralPath $target -Raw

if ([string]::IsNullOrWhiteSpace($content)) {
  Fail "Target file is empty: $target"
}

if ($content -match 'DRIVER_NOT_ELIGIBLE' -or
    $content -match 'DRIVER_LOCATION_NOT_FOUND' -or
    $content -match 'DISPATCH_ASSIGN_DRIVER_LOCATION_READ_ERROR') {
  Warn "Eligibility guard markers already exist. No patch applied."
  exit 0
}

# Find BOOKING_NOT_FOUND block first
$bookingPattern = 'if\s*\(\s*!resolvedBookingId\s*\)\s*\{\s*return\s+NextResponse\.json\s*\(\s*\{\s*error:\s*"BOOKING_NOT_FOUND"\s*\}\s*,\s*\{\s*status:\s*404\s*\}\s*\)\s*;\s*\}'
$bookingMatch = [regex]::Match($content, $bookingPattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)

if (-not $bookingMatch.Success) {
  Fail "Could not locate BOOKING_NOT_FOUND block in route.ts"
}

# Find the next 'if (driverId === fromDriverId)' AFTER the booking not found block
$searchStart = $bookingMatch.Index + $bookingMatch.Length
$tail = $content.Substring($searchStart)

$driverSamePattern = 'if\s*\(\s*driverId\s*===\s*fromDriverId\s*\)\s*\{'
$driverSameMatch = [regex]::Match($tail, $driverSamePattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)

if (-not $driverSameMatch.Success) {
  Fail "Could not locate 'if (driverId === fromDriverId)' after BOOKING_NOT_FOUND block"
}

$insertAt = $searchStart + $driverSameMatch.Index

$guard = @'

    // ===== DRIVER ELIGIBILITY GUARD (LIVE PRESENCE) =====
    try {
      const { data: locRows, error: locErr } = await supabase
        .from("driver_locations")
        .select("driver_id, status, updated_at")
        .eq("driver_id", driverId)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (locErr) {
        console.error("DISPATCH_ASSIGN_DRIVER_LOCATION_READ_ERROR", locErr);
        return NextResponse.json(
          { error: "DISPATCH_ASSIGN_DRIVER_LOCATION_READ_ERROR", message: locErr.message },
          { status: 500 }
        );
      }

      const loc = (locRows ?? [])[0] as any;

      if (!loc) {
        return NextResponse.json(
          { error: "DRIVER_LOCATION_NOT_FOUND", driverId },
          { status: 409 }
        );
      }

      const updatedAtMs = new Date(loc.updated_at ?? 0).getTime();
      const ageSeconds = Number.isFinite(updatedAtMs)
        ? Math.floor((Date.now() - updatedAtMs) / 1000)
        : 999999;

      const STALE_THRESHOLD_SEC = 60;
      const isStale = ageSeconds > STALE_THRESHOLD_SEC;

      const rawStatus = String(loc.status ?? "").trim().toLowerCase();
      const effectiveStatus = isStale ? "offline" : rawStatus;

      const assignEligible =
        !isStale &&
        (
          effectiveStatus === "online" ||
          effectiveStatus === "available" ||
          effectiveStatus === "idle" ||
          effectiveStatus === "waiting"
        );

      if (!assignEligible) {
        return NextResponse.json(
          {
            error: "DRIVER_NOT_ELIGIBLE",
            driverId,
            effectiveStatus,
            isStale,
            ageSeconds,
          },
          { status: 409 }
        );
      }
    } catch (e: any) {
      console.error("DISPATCH_ASSIGN_DRIVER_LOCATION_THROWN", e);
      return NextResponse.json(
        {
          error: "DISPATCH_ASSIGN_DRIVER_LOCATION_THROWN",
          message: e?.message ?? "Unexpected driver eligibility error",
        },
        { status: 500 }
      );
    }

'@

$backupDir = Join-Path $WebRoot "app\api\dispatch\assign\_patch_bak"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $backupDir ("route.ts.bak.ENFORCE_LIVE_DRIVER_ELIGIBILITY_V3." + $stamp)
Copy-Item -LiteralPath $target -Destination $backup -Force
Ok "Backup: $backup"

$newContent = $content.Substring(0, $insertAt) + $guard + $content.Substring($insertAt)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $newContent, $utf8NoBom)
Ok "Patched: $target"

$verify = Get-Content -LiteralPath $target -Raw

$markers = @(
  'DRIVER_LOCATION_NOT_FOUND',
  'DRIVER_NOT_ELIGIBLE',
  'DISPATCH_ASSIGN_DRIVER_LOCATION_READ_ERROR',
  'DISPATCH_ASSIGN_DRIVER_LOCATION_THROWN',
  'STALE_THRESHOLD_SEC = 60',
  '.from("driver_locations")',
  '.eq("driver_id", driverId)'
)

$missing = @()
foreach ($m in $markers) {
  if ($verify.IndexOf($m) -lt 0) {
    $missing += $m
  }
}

if ($missing.Count -gt 0) {
  Fail ("Patch wrote file but verification failed. Missing markers: " + ($missing -join ", "))
}

# Optional sanity check: inserted before no-change block
$guardPos = $verify.IndexOf('DRIVER_NOT_ELIGIBLE')
$sameDriverPos = $verify.IndexOf('if (driverId === fromDriverId)')
if ($guardPos -lt 0 -or $sameDriverPos -lt 0 -or $guardPos -gt $sameDriverPos) {
  Fail "Guard verification failed: inserted block is not before the same-driver no-change block."
}

Ok "Verification passed."
Write-Host "  - DRIVER_LOCATION_NOT_FOUND"
Write-Host "  - DRIVER_NOT_ELIGIBLE"
Write-Host "  - DISPATCH_ASSIGN_DRIVER_LOCATION_READ_ERROR"
Write-Host "  - DISPATCH_ASSIGN_DRIVER_LOCATION_THROWN"
Write-Host "  - STALE_THRESHOLD_SEC = 60"

Write-Host ""
Info "NEXT STEPS"
Write-Host "1) Build the web app"
Write-Host "2) Test stale/offline driver assignment => expect 409 DRIVER_NOT_ELIGIBLE"
Write-Host "3) Test fresh online driver assignment => expect success"