# FIX-JRIDE_PHASE13D_DRIVER_GEO_GATE_SCOPE_RECOVER.ps1
# Repair: ensure driver geo gate state + UI panel are in the SAME component scope (DriverDashboard)
# File: app/driver/page.tsx
# One file only. No manual edits. ASCII-only UI strings.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$rel = "app\driver\page.tsx"
$path = Join-Path (Get-Location).Path $rel
if (!(Test-Path $path)) { Fail "File not found: $path`nRun from repo root." }

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

# 0) Remove any previously inserted UI panel block (wherever it is)
$panelPat = '(?s)\s*\{\s*/\*\s*PHASE13-D_DRIVER_GEO_GATE_UI_PANEL\s*\*/\s*\}.*?\{\s*/\*\s*END\s*PHASE13-D_DRIVER_GEO_GATE_UI_PANEL\s*\*/\s*\}\s*'
$txt2 = [regex]::Replace($txt, $panelPat, "`r`n")
if ($txt2 -ne $txt) { Ok "Removed existing geo gate UI panel block (cleanup)." }
$txt = $txt2

# 1) Ensure we're patching inside DriverDashboard
if ($txt -notmatch '(?m)^\s*export\s+default\s+function\s+DriverDashboard\s*\(\)\s*\{') {
  Fail "Could not find: export default function DriverDashboard() {"
}

# 2) Ensure geo state + helpers exist inside DriverDashboard (insert after driverId state block)
if ($txt -notmatch 'const\s*\[\s*geoPermission\s*,\s*setGeoPermission\s*\]') {
  $driverIdBlock = '(?s)(export\s+default\s+function\s+DriverDashboard\s*\(\)\s*\{\s*.*?const\s*\[\s*driverId\s*,\s*setDriverId\s*\]\s*=\s*useState<[^>]+>\(\s*.*?\);\s*)'
  if ($txt -notmatch $driverIdBlock) {
    Fail "Could not find driverId useState block to insert geo gate after."
  }

  $geoInsert = @'
  // PHASE13-D_DRIVER_GEO_GATE
  function inIfugaoBBox(lat: number, lng: number): boolean {
    // Conservative bbox, same as passenger gate
    return lat >= 16.5 && lat <= 17.2 && lng >= 120.8 && lng <= 121.4;
  }

  const [geoPermission, setGeoPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [geoInsideIfugao, setGeoInsideIfugao] = useState<boolean | null>(null);
  const [geoErr, setGeoErr] = useState<string>("");

  // Must be called directly from a click handler on mobile browsers
  function promptDriverGeoFromClick() {
    setGeoErr("");

    try {
      const anyGeo: any = (navigator as any)?.geolocation;
      if (!anyGeo || !anyGeo.getCurrentPosition) {
        setGeoPermission("denied");
        setGeoInsideIfugao(null);
        setGeoErr("Geolocation not available.");
        return;
      }

      const ua = String((navigator as any)?.userAgent || "");
      const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);

      anyGeo.getCurrentPosition(
        (pos: any) => {
          const lat = Number(pos?.coords?.latitude);
          const lng = Number(pos?.coords?.longitude);

          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            setGeoPermission("unknown");
            setGeoInsideIfugao(null);
            setGeoErr("Could not read coordinates.");
            return;
          }

          setGeoPermission("granted");
          setGeoInsideIfugao(inIfugaoBBox(lat, lng));
        },
        (err: any) => {
          const code = Number(err?.code || 0);
          const msg = String(err?.message || err || "");
          setGeoInsideIfugao(null);

          if (code === 1) {
            setGeoPermission("denied");
            setGeoErr("Location permission denied.");
          } else {
            setGeoPermission("unknown");
            setGeoErr(msg ? ("Location error: " + msg) : "Location error.");
          }
        },
        {
          enableHighAccuracy: isMobile ? true : true,
          timeout: isMobile ? 15000 : 10000,
          maximumAge: 0,
        }
      );
    } catch (e: any) {
      setGeoPermission("unknown");
      setGeoInsideIfugao(null);
      setGeoErr("Location check failed.");
    }
  }

  const driverGeoOk = geoPermission === "granted" && geoInsideIfugao === true;

'@

  $txt = [regex]::Replace($txt, $driverIdBlock, "`$1`r`n$geoInsert", 1)
  Ok "Inserted geo gate state + helpers inside DriverDashboard()."
} else {
  Info "geoPermission state already exists. Skipping state insert."
}

# 3) Insert the UI panel inside DriverDashboard return(), right after the first <h1 ...>...</h1>
$dashReturnPat = '(?s)(export\s+default\s+function\s+DriverDashboard\s*\(\)\s*\{.*?return\s*\(\s*)(.*?)(\s*\);\s*\}\s*$)'
if ($txt -notmatch $dashReturnPat) {
  Fail "Could not locate DriverDashboard return(...) block."
}

$geoPanel = @'
      {/* PHASE13-D_DRIVER_GEO_GATE_UI_PANEL */}
      <div className="mt-3 border rounded-2xl p-3 bg-amber-50 border-amber-300 space-y-2">
        <div className="font-medium text-amber-900">Driver location check</div>
        <div className="text-xs text-amber-900/80">
          Permission: {geoPermission} | Inside Ifugao: {String(geoInsideIfugao)}
        </div>
        {geoErr ? <div className="text-xs text-red-700">{geoErr}</div> : null}
        <button
          type="button"
          className="border rounded px-3 py-2 bg-amber-900 text-white"
          onClick={() => promptDriverGeoFromClick()}
        >
          {geoPermission === "granted" ? "Re-check location" : "Enable location"}
        </button>
      </div>
      {/* END PHASE13-D_DRIVER_GEO_GATE_UI_PANEL */}

'@

# Insert after the first <h1>...</h1> that appears AFTER return(
$txt = [regex]::Replace($txt, $dashReturnPat, {
  param($m)
  $prefix = $m.Groups[1].Value
  $body   = $m.Groups[2].Value
  $suffix = $m.Groups[3].Value

  if ($body -match 'PHASE13-D_DRIVER_GEO_GATE_UI_PANEL') { return $m.Value }

  $h1Pat = '(?s)(<h1\b[^>]*>.*?</h1>)'
  if ($body -notmatch $h1Pat) {
    # If no h1, place panel at very top of body
    return $prefix + $geoPanel + $body + $suffix
  }

  $body2 = [regex]::Replace($body, $h1Pat, { param($mm) $mm.Groups[1].Value + "`r`n" + $geoPanel }, 1)
  return $prefix + $body2 + $suffix
}, 1)
Ok "Inserted geo gate UI panel inside DriverDashboard return."

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Ok "Driver geo gate scope recovered (geoPermission now in scope)."
