# PATCH-LIVETRIPS-MAP-RESIZE.ps1
# Adds ResizeObserver + map.resize() after init to fix blank map on prod
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$t = Get-Content -LiteralPath $f -Raw -Encoding UTF8

$needle = "    mapRef.current = map;"
if ($t -notmatch [regex]::Escape($needle)) { Fail "Could not find anchor: mapRef.current = map;" }

$insert = @'
    mapRef.current = map;

    // Fix: map can render blank if initialized before container has final size (common in prod)
    const ro = new ResizeObserver(() => {
      try { map.resize(); } catch {}
    });
    if (containerRef.current) ro.observe(containerRef.current);
    setTimeout(() => { try { map.resize(); } catch {} }, 0);
'@

# Replace only the FIRST occurrence using regex
$rxNeedle = [regex]::Escape($needle)
$t = [regex]::Replace($t, $rxNeedle, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $insert.TrimEnd() }, 1)

# Patch cleanup: add ro.disconnect() in the effect cleanup if we can find "return () => {"
# We'll insert right after the opening brace of the first cleanup return
$rxCleanup = '(?s)return\s*\(\)\s*=>\s*\{\s*'
if ($t -match $rxCleanup) {
  $t = [regex]::Replace($t, $rxCleanup, "return () => {`r`n      try { ro.disconnect(); } catch { }`r`n      ", 1)
} else {
  Write-Host "WARN: Could not find cleanup block to add ro.disconnect()." -ForegroundColor Yellow
}

Set-Content -LiteralPath $f -Value $t -Encoding UTF8
Write-Host "PATCHED: $f" -ForegroundColor Green
