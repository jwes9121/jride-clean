# PATCH-JRIDE_PHASE13C2_1_MOBILE_LOCATION_FIX.ps1
# Phase 13-C2.1: Mobile geolocation reliability (user-tap prompt uses high accuracy + longer timeout)
# File: app/ride/page.tsx
# One file only. No manual edits.

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

# Idempotency marker
if ($txt -match "PHASE13-C2_1_MOBILE_GEO") {
  Info "Phase 13-C2.1 already present. No change."
  exit 0
}

# 1) Insert isMobile inside refreshGeoGate() after prompt line
$promptLinePat = '(?m)^\s*const\s+prompt\s*=\s*!!opts\?\.(?:prompt);\s*$'
if ($txt -notmatch $promptLinePat) { Fail "Could not find refreshGeoGate prompt line." }

$promptInsert = @'
    const prompt = !!opts?.prompt;

    // PHASE13-C2_1_MOBILE_GEO: mobile browsers often need a user-initiated, high-accuracy request
    const isMobile =
      typeof navigator !== "undefined" &&
      /Android|iPhone|iPad|iPod/i.test(String((navigator as any)?.userAgent || ""));

'@

$txt = [regex]::Replace($txt, $promptLinePat, $promptInsert, 1)
Ok "Inserted mobile detection inside refreshGeoGate()."

# 2) Replace getCurrentPosition options with mobile-aware options
# We expect an options object containing enableHighAccuracy/timeout/maximumAge
$optionsPat = '(?s)\{\s*enableHighAccuracy:\s*false,\s*timeout:\s*8000,\s*maximumAge:\s*60000,\s*\}'
if ($txt -notmatch $optionsPat) {
  Fail "Could not find getCurrentPosition options block (enableHighAccuracy/timeout/maximumAge)."
}

$optionsRepl = @'
{
            // On mobile, when user taps "Enable location", request better accuracy and allow more time.
            enableHighAccuracy: prompt && isMobile,
            timeout: prompt && isMobile ? 15000 : 8000,
            maximumAge: 60000,
          }
'@

$txt = [regex]::Replace($txt, $optionsPat, $optionsRepl, 1)
Ok "Updated geolocation options for mobile user-initiated checks."

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Ok "Phase 13-C2.1 mobile location fix applied."
