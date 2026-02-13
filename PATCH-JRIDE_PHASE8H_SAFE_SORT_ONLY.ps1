# PATCH-JRIDE_PHASE8H_SAFE_SORT_ONLY.ps1
# Adds safe, render-time sorting for visibleTrips (problem first, most stale first)
# ASCII-safe (no unicode punctuation)

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

$path = "app\admin\livetrips\LiveTripsClient.tsx"
if(!(Test-Path $path)){ Fail "Missing $path" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $path "$path.bak.$ts" -Force
Ok "Backup created: $path.bak.$ts"

$txt = Get-Content $path -Raw

# Anchor: wherever SmartAutoAssignSuggestions receives the trips prop
$anchor = 'trips=\{visibleTrips as any\}'

if($txt -match $anchor){

  $replacement = @'
trips={
  [...(visibleTrips as any)].sort((a: any, b: any) => {
    const ap = isProblemTrip(a) ? 1 : 0;
    const bp = isProblemTrip(b) ? 1 : 0;
    if (ap !== bp) return bp - ap;

    const am = minutesSince(a?.updated_at || a?.created_at || null);
    const bm = minutesSince(b?.updated_at || b?.created_at || null);
    if (am !== bm) return bm - am;

    return 0;
  }) as any
}
'@

  $txt = [regex]::Replace($txt, $anchor, $replacement, 1)
  Set-Content -Path $path -Value $txt -Encoding UTF8
  Ok "Safe sorting applied (problem first, most stale first)"

} else {
  Warn "Anchor not found - sorting skipped (UI remains unchanged)"
}
