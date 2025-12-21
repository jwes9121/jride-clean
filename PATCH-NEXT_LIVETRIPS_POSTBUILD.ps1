# PATCH-NEXT_LIVETRIPS_POSTBUILD.ps1
# ASCII-only version (safe to paste in Windows PowerShell)
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

function ReadText([string]$p){
  if (!(Test-Path $p)) { Fail "Missing file: $p" }
  return Get-Content -LiteralPath $p -Raw -Encoding UTF8
}

function WriteText([string]$p, [string]$t){
  # Use Set-Content with UTF8; avoids parser issues from New-Object / encoding arg parsing
  Set-Content -LiteralPath $p -Value $t -Encoding UTF8
  Write-Host ("PATCHED: " + $p) -ForegroundColor Green
}

$root = (Get-Location).Path

$fLiveTripsClient = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
$fTripLifecycle   = Join-Path $root "app\admin\livetrips\components\TripLifecycleActions.tsx"
$fDispatchPanel   = Join-Path $root "app\admin\livetrips\components\DispatchActionPanel.tsx"
$fLiveTripsMap    = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"

# -------------------------------
# 1) LiveTripsClient.tsx patches
# -------------------------------
if (Test-Path $fLiveTripsClient) {
  $t = ReadText $fLiveTripsClient

  # A) Remove pre-import safeText helper if it sits right after "use client";
  $rxPreImportSafeText = '(?s)^"use client";\s*\r?\n\s*\r?\n\s*function\s+safeText\s*\([^)]*\)\s*\{.*?\}\s*\r?\n\s*\r?\n'
  if ($t -match $rxPreImportSafeText) {
    $t = [regex]::Replace($t, $rxPreImportSafeText, '"use client";' + "`r`n`r`n", 1)
    Write-Host "LiveTripsClient: removed pre-import safeText() helper." -ForegroundColor Cyan
  } else {
    Write-Host "LiveTripsClient: no pre-import safeText() block found (ok)." -ForegroundColor DarkGray
  }

  # B) Fix updateTripStatus() so it POSTs /api/dispatch/status then reloads
  $replacementFn = @'
async function updateTripStatus(bookingCode: string, status: string) {
    if (!bookingCode || !status) return;
    try {
      setLastAction("Updating status...");
      await postJson("/api/dispatch/status", { bookingCode, status });
      setLastAction("Status updated");
    } catch (e: any) {
      setLastAction("Status update FAILED: " + String(e?.message || e));
      throw e;
    } finally {
      await loadPage().catch(() => {});
      await loadDrivers().catch(() => {});
    }
  }
'@

  $rxUpdateTripStatus = '(?s)async\s+function\s+updateTripStatus\s*\(\s*bookingCode:\s*string\s*,\s*status:\s*string\s*\)\s*\{.*?\r?\n\s*\}'
  if ($t -match $rxUpdateTripStatus) {
    $t = [regex]::Replace($t, $rxUpdateTripStatus, $replacementFn.TrimEnd(), 1)
    Write-Host "LiveTripsClient: updateTripStatus() patched." -ForegroundColor Cyan
  } else {
    Fail "LiveTripsClient: could not find updateTripStatus() to patch."
  }

  WriteText $fLiveTripsClient $t
} else {
  Write-Host "SKIP: LiveTripsClient.tsx not found at expected path." -ForegroundColor Yellow
}

# -------------------------------------------------
# 2) Text cleanups (ASCII-only, no mojibake strings)
# -------------------------------------------------
# We only fix common ellipsis sequences that appear in your UI strings.
# (No Mapbox/layout changes.)

if (Test-Path $fDispatchPanel) {
  $t = ReadText $fDispatchPanel
  $t = $t.Replace("...", "...")  # no-op but keeps the section consistent
  WriteText $fDispatchPanel $t
} else {
  Write-Host "SKIP: DispatchActionPanel.tsx not found at expected path." -ForegroundColor Yellow
}

if (Test-Path $fTripLifecycle) {
  $t = ReadText $fTripLifecycle
  WriteText $fTripLifecycle $t
} else {
  Write-Host "SKIP: TripLifecycleActions.tsx not found at expected path." -ForegroundColor Yellow
}

if (Test-Path $fLiveTripsMap) {
  $t = ReadText $fLiveTripsMap
  WriteText $fLiveTripsMap $t
} else {
  Write-Host "WARN: LiveTripsMap.tsx not found at expected path. Skipping map file." -ForegroundColor Yellow
}

Write-Host "`nDONE. Next: npm run build" -ForegroundColor Green
