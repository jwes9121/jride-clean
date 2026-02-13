# PATCH-JRIDE_P6B_PAGE_DATA_SUGGESTED_VERIFIED_FARE_V2.ps1
# P6B: Backend-only - include suggested_verified_fare in /api/admin/livetrips/page-data payload
# HARD RULES: ANCHOR_BASED_ONLY, NO_DECLARE, NO_REDECLARE_NO_DECLARE, DO_NOT_TOUCH_DISPATCH_STATUS

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$target = Join-Path $root "app\api\admin\livetrips\page-data\route.ts"
if(!(Test-Path $target)){ Fail "Target not found: $target" }

$txt = Get-Content -LiteralPath $target -Raw -Encoding UTF8

# Anchor: we must have the payload block exactly in this route style
$anchorPayload = "const payload ="
if($txt.IndexOf($anchorPayload) -lt 0){ Fail "Anchor not found: const payload =" }

# Anchor: this exact trips extraction exists
$anchorTrips = "const trips = extractTripsAnyShape(rpcData);"
if($txt.IndexOf($anchorTrips) -lt 0){ Fail "Anchor not found: $anchorTrips" }

# Backup
$bak = "$target.bak.$(Stamp)"
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

# Inject tripsOut before const payload =
$injectRegex = "(?m)^\s*const payload\s*=\s*$"
if(-not [regex]::IsMatch($txt, $injectRegex)){ Fail "Could not locate payload declaration line for injection." }

$injectBlock = @"
  const tripsOut = (Array.isArray(trips) ? trips : []).map((t: any) => ({
    ...t,
    suggested_verified_fare:
      (t as any)?.suggested_verified_fare ??
      (t as any)?.suggestedVerifiedFare ??
      (t as any)?.verified_suggested_fare ??
      (t as any)?.fare_suggested_verified ??
      (t as any)?.suggested_fare_verified ??
      (t as any)?.suggested_fare ??
      null,
  }));

  const payload =
"@

$txt2 = [regex]::Replace($txt, $injectRegex, $injectBlock, 1)
if($txt2 -eq $txt){ Fail "Injection failed (no change)." }

# Now replace payload usages of trips -> tripsOut (both branches)
# 1) { ...(rpcData as any), trips, __debug: ... }  -> trips: tripsOut
$txt3 = $txt2
$before = $txt3

$txt3 = [regex]::Replace($txt3, "(?s)\{\s*\.\.\.\(rpcData as any\)\s*,\s*trips\s*,", "{ ...(rpcData as any), trips: tripsOut,", 1)
$txt3 = [regex]::Replace($txt3, "(?s)\{\s*trips\s*,\s*__debug:", "{ trips: tripsOut, __debug:", 1)

if($txt3 -eq $before){
  Fail "Expected to replace 'trips' in payload but no changes were made (anchors may differ)."
}

Set-Content -LiteralPath $target -Value $txt3 -Encoding UTF8
Write-Host "[OK] Patched: $target"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) npm.cmd run build"
Write-Host "  2) Open /api/admin/livetrips/page-data?debug=1 and confirm trips[*].suggested_verified_fare is present (often null until upstream provides it)"
