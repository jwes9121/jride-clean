# PATCH-LIVETRIPSCLIENT-SMARTAUTOASSIGN-PROPS.ps1
# Fixes Vercel/Next build error by providing required props to SmartAutoAssignSuggestions:
# - zoneStats
# - onAssign
# Uses existing zones state + assignDriver() function. No UI/layout changes.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$txt  = Get-Content -Raw -Encoding UTF8 $f
$orig = $txt

# 1) Insert zoneStats useMemo right after selectedTrip useMemo (stable anchor)
$anchor = '(?s)(const\s+selectedTrip\s*=\s*useMemo\(\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[[^\]]*\]\s*\);\s*)'
if ($txt -notmatch $anchor) { Fail "Could not find selectedTrip useMemo block to anchor insertion." }

if ($txt -notmatch 'const\s+zoneStats\s*=\s*useMemo') {
  $insert = @'
$1

  const zoneStats = useMemo(() => {
    const m: Record<string, { util: number; status: string }> = {};
    (zones || []).forEach((z: any) => {
      const key = String(z?.zone_name || z?.town || z?.zone || "").trim();
      if (!key) return;
      const lim = Number(z?.capacity_limit ?? 0);
      const active = Number(z?.active_drivers ?? 0);
      const util = lim > 0 ? active / lim : 0;
      const status = String(z?.status || "OK");
      m[key] = { util, status };
    });
    return m;
  }, [zones]);

'@
  $txt = [regex]::Replace($txt, $anchor, $insert, 1)
}

# 2) Patch the SmartAutoAssignSuggestions call to include required props
# Replace exact minimal call pattern:
# <SmartAutoAssignSuggestions trip={selectedTrip as any} drivers={drivers as any} />
$callPattern = '<SmartAutoAssignSuggestions\s+trip=\{selectedTrip\s+as\s+any\}\s+drivers=\{drivers\s+as\s+any\}\s*\/>'
if ($txt -notmatch $callPattern) {
  Fail "Could not find SmartAutoAssignSuggestions call with trip/drivers only. Search and paste that JSX line if it differs."
}

$replacementCall = @'
<SmartAutoAssignSuggestions
  trip={selectedTrip as any}
  drivers={drivers as any}
  zoneStats={zoneStats as any}
  onAssign={(driverId: string) => {
    const bc = (selectedTrip as any)?.booking_code || (selectedTrip as any)?.bookingCode;
    if (!bc) return;
    return assignDriver(String(bc), String(driverId));
  }}
/>
'@

$txt = [regex]::Replace($txt, $callPattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $replacementCall }, 1)

if ($txt -eq $orig) { Fail "No changes applied (unexpected)." }

Set-Content -Path $f -Value $txt -Encoding UTF8
Write-Host "OK: LiveTripsClient now passes zoneStats + onAssign to SmartAutoAssignSuggestions." -ForegroundColor Green
Write-Host "Next: restart dev + run build." -ForegroundColor Cyan
