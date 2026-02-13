# PATCH-JRIDE_PHASE13C2_1_MOBILE_GEO_CLICK_FIXED.ps1
# Phase 13-C2.1: Mobile geolocation hard trigger (direct click -> getCurrentPosition)
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

# 1) Insert promptGeoFromClick() helper right before refreshGeoGate()
$anchor = '(?s)\n(\s*)async function refreshGeoGate\s*\(opts\?:\s*\{\s*prompt\?:\s*boolean\s*\}\)\s*\{'
if ($txt -notmatch $anchor) { Fail "Could not find refreshGeoGate() signature anchor." }

$helper = @'
  // PHASE13-C2_1_MOBILE_GEO_CLICK
  // Mobile Chrome can require geolocation to be called directly inside a user gesture handler.
  // This must be called from an onClick handler. It triggers getCurrentPosition immediately.
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

$txt = [regex]::Replace($txt, $anchor, "`n`$1$helper`n`$1async function refreshGeoGate(opts?: { prompt?: boolean }) {", 1)
Ok "Inserted promptGeoFromClick() helper."

# 2) Rewire any click handlers that call refreshGeoGate({ prompt: true }) to call promptGeoFromClick()
# Covers common variants:
# onClick={() => refreshGeoGate({ prompt: true })}
# onClick={() => refreshGeoGate({prompt:true})}
$patClick = 'onClick=\{\(\)\s*=>\s*refreshGeoGate\(\{\s*prompt\s*:\s*true\s*\}\)\s*\}'
$txtNew = [regex]::Replace($txt, $patClick, 'onClick={() => promptGeoFromClick()}')
$txt = $txtNew

Ok "Rewired click handlers (refreshGeoGate prompt -> promptGeoFromClick)."

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Ok "Phase 13-C2.1 applied (mobile geolocation click trigger)."
