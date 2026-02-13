# PATCH-JRIDE_PHASE13C2_1_MOBILE_GEO_CLICK.ps1
# Phase 13-C2.1: Mobile geolocation hard trigger (must be called directly inside click handler)
# File: app/ride/page.tsx
# One file only. No manual edits. No Mapbox changes.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$rel = "app\ride\page.tsx"
$path = Join-Path (Get-Location).Path $rel
if (!(Test-Path $path)) { Fail "File not found: $path`nRun from repo root." }

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

# Idempotency
if ($txt -match "PHASE13-C2_1_MOBILE_GEO_CLICK") {
  Info "Phase 13-C2.1 already present. No change."
  exit 0
}

# 1) Insert a click-safe geolocation trigger helper (no await before getCurrentPosition)
$anchor1 = '(?s)async function refreshGeoGate\s*\(opts\?:\s*\{\s*prompt\?:\s*boolean\s*\}\)\s*\{'
if ($txt -notmatch $anchor1) { Fail "Could not find refreshGeoGate() function. File changed unexpectedly." }

# Place helper BEFORE refreshGeoGate (safe, simple anchor)
$helper = @'
  // PHASE13-C2_1_MOBILE_GEO_CLICK
  // Mobile Chrome can require geolocation to be called directly inside a user gesture handler.
  // This function MUST be called from an onClick handler. It triggers getCurrentPosition immediately.
  function promptGeoFromClick() {
    setGeoGateErr("");

    try {
      const anyGeo: any = (navigator as any)?.geolocation;
      if (!anyGeo || !anyGeo.getCurrentPosition) {
        setGeoGateErr("Geolocation not available on this device/browser.");
        setGeoPermission("denied");
        setGeoInsideIfugao(null);
        setGeoCheckedAt(Date.now());
        return;
      }

      const ua = String((navigator as any)?.userAgent || "");
      const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);

      // IMPORTANT: call getCurrentPosition immediately (no await / no permission query first)
      anyGeo.getCurrentPosition(
        (pos: any) => {
          const lat = Number(pos?.coords?.latitude);
          const lng = Number(pos?.coords?.longitude);

          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            setGeoGateErr("Could not read coordinates.");
            setGeoInsideIfugao(null);
            setGeoCheckedAt(Date.now());
            return;
          }

          setGeoPermission("granted");
          setGeoLat(lat);
          setGeoLng(lng);
          setGeoInsideIfugao(inIfugaoBBox(lat, lng));
          setGeoCheckedAt(Date.now());
        },
        (err: any) => {
          const code = Number(err?.code || 0);
          const msg = String(err?.message || err || "");

          if (code === 1) {
            setGeoPermission("denied");
            setGeoGateErr("Location permission denied.");
          } else {
            setGeoGateErr(msg ? ("Location error: " + msg) : "Location error.");
          }
          setGeoInsideIfugao(null);
          setGeoCheckedAt(Date.now());
        },
        {
          enableHighAccuracy: isMobile ? true : false,
          timeout: isMobile ? 15000 : 8000,
          maximumAge: 0,
        }
      );
    } catch (e: any) {
      setGeoGateErr("Location check failed: " + String(e?.message || e));
      setGeoInsideIfugao(null);
      setGeoCheckedAt(Date.now());
    }
  }

'@

$txt = [regex]::Replace(
  $txt,
  $anchor1,
  { param($m) $helper + $m.Value },
  1
)
Ok "Inserted promptGeoFromClick() helper."

# 2) Replace any buttons that call refreshGeoGate({ prompt: true }) with promptGeoFromClick()
# We do a conservative replace: only the exact pattern with prompt: true.
$before = ([regex]::Matches($txt, 'onClick=\{\(\)\s*=>\s*refreshGeoGate\(\{\s*prompt:\s*true\s*\}\)\s*\}').Count
$txt = [regex]::Replace(
  $txt,
  'onClick=\{\(\)\s*=>\s*refreshGeoGate\(\{\s*prompt:\s*true\s*\}\)\s*\}',
  'onClick={() => promptGeoFromClick()}'
)

$after = ([regex]::Matches($txt, 'onClick=\{\(\)\s*=>\s*refreshGeoGate\(\{\s*prompt:\s*true\s*\}\)\s*\}').Count

if ($before -eq 0) {
  Info "No onClick={() => refreshGeoGate({ prompt: true })} found (maybe already changed)."
} else {
  Ok ("Rewired click handlers: " + $before + " occurrence(s). Remaining: " + $after)
}

# Also catch a common variant: onClick={() => refreshGeoGate({ prompt: true })}
$before2 = ([regex]::Matches($txt, 'onClick=\{\(\)\s*=>\s*refreshGeoGate\(\{\s*prompt:\s*true\s*\}\)\s*\}').Count
# already handled above, but keep for clarity
# (no additional replace)

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Ok "Phase 13-C2.1 applied (mobile geolocation click trigger)."
