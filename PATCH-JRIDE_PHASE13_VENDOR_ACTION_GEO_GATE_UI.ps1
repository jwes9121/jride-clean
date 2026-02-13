# PATCH-JRIDE_PHASE13_VENDOR_ACTION_GEO_GATE_UI.ps1
# Phase 13: Vendor action gating (UI-only) for app/vendor-orders/page.tsx
# - Page remains accessible anywhere
# - Actions disabled unless location permission granted AND inside Ifugao bbox
# One file only. No backend changes. No schema assumptions.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$rel = "app\vendor-orders\page.tsx"
$path = Join-Path (Get-Location).Path $rel
if (!(Test-Path $path)) { Fail "File not found: $path (run from repo root)" }

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

if ($txt -match "PHASE13_VENDOR_ACTION_GEO_GATE") {
  Info "Phase 13 vendor geo gate already present. No change."
  exit 0
}

# 1) Insert geo gate state + helper right after updatingId state (best anchor)
$anchorUpdating = '(?m)^\s*const\s*\[\s*updatingId\s*,\s*setUpdatingId\s*\]\s*=\s*useState<\s*string\s*\|\s*null\s*>\(\s*null\s*\);\s*$'
if ($txt -notmatch $anchorUpdating) { Fail "Could not find updatingId state anchor." }

$geoBlock = @'

  // PHASE13_VENDOR_ACTION_GEO_GATE
  // UI-only: vendor can view page anywhere, but ACTIONS require location permission + inside Ifugao.
  const [vGeoPermission, setVGeoPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [vGeoInsideIfugao, setVGeoInsideIfugao] = useState<boolean>(false);
  const [vGeoErr, setVGeoErr] = useState<string | null>(null);
  const [vGeoLast, setVGeoLast] = useState<{ lat: number; lng: number } | null>(null);

  // Generous bbox to avoid false "outside" for Ifugao towns (includes Lamut/Kiangan edges)
  const IFUGAO_BBOX = { minLat: 16.40, maxLat: 17.80, minLng: 120.80, maxLng: 121.70 };

  function inIfugaoBBox(lat: number, lng: number) {
    return (
      lat >= IFUGAO_BBOX.minLat &&
      lat <= IFUGAO_BBOX.maxLat &&
      lng >= IFUGAO_BBOX.minLng &&
      lng <= IFUGAO_BBOX.maxLng
    );
  }

  async function refreshVendorGeoGate(opts?: { prompt?: boolean }) {
    try {
      setVGeoErr(null);

      if (typeof window === "undefined" || typeof navigator === "undefined") {
        setVGeoPermission("unknown");
        setVGeoInsideIfugao(false);
        return;
      }

      if (!("geolocation" in navigator)) {
        setVGeoPermission("denied");
        setVGeoInsideIfugao(false);
        setVGeoErr("Geolocation not supported on this device/browser.");
        return;
      }

      const permApi: any = (navigator as any).permissions;
      if (permApi && permApi.query) {
        try {
          const st = await permApi.query({ name: "geolocation" });
          if (st?.state === "granted") setVGeoPermission("granted");
          else if (st?.state === "denied") setVGeoPermission("denied");
          else setVGeoPermission("unknown");
        } catch {
          // ignore
        }
      }

      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: opts?.prompt ? 0 : 30000,
        });
      });

      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      setVGeoLast({ lat, lng });
      setVGeoPermission("granted");

      const inside = inIfugaoBBox(lat, lng);
      setVGeoInsideIfugao(inside);
      if (!inside) {
        setVGeoErr("Action blocked: you appear outside Ifugao.");
      }
    } catch (e: any) {
      const code = e?.code;
      const msg =
        code === 1
          ? "Location permission denied. Actions are disabled."
          : code === 2
          ? "Location unavailable. Actions are disabled."
          : code === 3
          ? "Location request timed out. Actions are disabled."
          : e?.message || "Location check failed. Actions are disabled.";

      setVGeoPermission(code === 1 ? "denied" : "unknown");
      setVGeoInsideIfugao(false);
      setVGeoErr(msg);
    }
  }

  useEffect(() => {
    refreshVendorGeoGate({ prompt: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const vendorActionBlocked = !(vGeoPermission === "granted" && vGeoInsideIfugao);

'@

$txt = [regex]::Replace($txt, $anchorUpdating, '$0' + $geoBlock, 1)
Ok "Inserted vendor geo gate state + helper."

# 2) Add a small banner near the top UI: insert just before the first <div className="flex ..."> if present,
# otherwise before the first "return (".
$banner = @'
      {/* PHASE13_VENDOR_ACTION_GEO_GATE: Action gating banner (page still accessible) */}
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium">Vendor action location check</div>
          <button
            type="button"
            className="rounded border border-amber-300 bg-white px-2 py-1 text-[11px] hover:bg-amber-100"
            onClick={() => refreshVendorGeoGate({ prompt: true })}
          >
            Refresh location
          </button>
        </div>
        <div className="mt-1 opacity-90">
          Permission: <span className="font-semibold">{vGeoPermission}</span> · Inside Ifugao:{" "}
          <span className="font-semibold">{String(vGeoInsideIfugao)}</span>
          {vGeoLast ? (
            <span className="opacity-80"> · {vGeoLast.lat.toFixed(5)},{vGeoLast.lng.toFixed(5)}</span>
          ) : null}
        </div>
        {vendorActionBlocked ? (
          <div className="mt-1 text-red-700">
            Actions disabled until location permission is granted and you are inside Ifugao.
            {vGeoErr ? <span className="opacity-90"> ({vGeoErr})</span> : null}
          </div>
        ) : (
          <div className="mt-1 text-emerald-700">Actions enabled.</div>
        )}
      </div>

'@

# Try inject after the first header container; fallback before return (
$headerPat = '(?s)(return\s*\(\s*\n\s*<div[^>]*>\s*\n)'
if ($txt -match $headerPat) {
  $txt = [regex]::Replace($txt, $headerPat, '$1' + $banner, 1)
  Ok "Inserted action gating banner after return opening."
} else {
  $retPat = '(?m)^\s*return\s*\(\s*$'
  if ($txt -notmatch $retPat) { Fail "Could not find return( anchor to insert banner." }
  $txt = [regex]::Replace($txt, $retPat, "  return (`r`n" + $banner, 1)
  Ok "Inserted action gating banner at return anchor."
}

# 3) Disable action buttons: add vendorActionBlocked to disabled=...
# Replace patterns safely.
$before = $txt

# Common: disabled={updatingId === o.id}
$txt = [regex]::Replace($txt, 'disabled=\{\s*updatingId\s*===\s*o\.id\s*\}', 'disabled={vendorActionBlocked || updatingId === o.id}', 0)

# Also handle: disabled={updatingId===o.id} (no spaces)
$txt = [regex]::Replace($txt, 'disabled=\{\s*updatingId\s*===\s*o\.id\s*\}', 'disabled={vendorActionBlocked || updatingId === o.id}', 0)

# If no disabled found, attempt generic: disabled={...updatingId...o.id...}
$txt = [regex]::Replace($txt, 'disabled=\{([^}]*(?:updatingId)[^}]*(?:o\.id)[^}]*)\}', 'disabled={vendorActionBlocked || $1}', 0)

$changedDisabled = ($txt -ne $before)
if ($changedDisabled) {
  Ok "Updated disabled=... to include vendorActionBlocked."
} else {
  Info "No disabled=... patterns updated (buttons may be using a different disabled prop)."
}

# 4) (Optional safety) Guard onClick handlers: if vendorActionBlocked, do nothing.
# This is extra-safe even if disabled patterns missed some buttons.
# Wrap handleStatusUpdate(...) calls: onClick={() => handleStatusUpdate(...)} -> onClick={() => vendorActionBlocked ? null : handleStatusUpdate(...)}
$txt = [regex]::Replace(
  $txt,
  'onClick=\{\(\)\s*=>\s*handleStatusUpdate\((.*?)\)\s*\}',
  'onClick={() => (vendorActionBlocked ? null : handleStatusUpdate($1))}',
  0
)

Ok "Added onClick guard for handleStatusUpdate calls (if present)."

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Ok "Phase 13 vendor action geo gate applied (UI-only)."
