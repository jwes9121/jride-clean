# PATCH-JRIDE_RIDE_MAP_STOP_RECENTER_V7.ps1
# Issue #2: Passenger map defaults to Lagawe + snaps back after taps.
# Fix (UI-only): One-time pickup init from geo, and prevent recenter loops while user interacts.
# Scope: app\ride\page.tsx ONLY. No backend changes.

$ErrorActionPreference = "Stop"

$FILE = "C:\Users\jwes9\Desktop\jride-clean-fresh\app\ride\page.tsx"
if (!(Test-Path $FILE)) { throw "File not found: $FILE" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$FILE.bak.$ts"
Copy-Item $FILE $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content $FILE -Raw

# ---------- 1) Insert Issue#2 refs + guards after pickup/drop state ----------
$stateBlockPattern = '(?s)(\s*const\s+\[pickupLat,\s*setPickupLat\]\s*=\s*React\.useState\("16\.7999"\);\s*\r?\n\s*const\s+\[pickupLng,\s*setPickupLng\]\s*=\s*React\.useState\("121\.1175"\);\s*\r?\n\s*const\s+\[dropLat,\s*setDropLat\]\s*=\s*React\.useState\("16\.8016"\);\s*\r?\n\s*const\s+\[dropLng,\s*setDropLng\]\s*=\s*React\.useState\("121\.1222"\);\s*\r?\n)'

if ($txt -notmatch $stateBlockPattern) {
  throw "Anchor missing: pickup/drop state block (expected default Lagawe coords)."
}

$insertGuards = @'
$1
  // JRIDE ISSUE#2 (UI-only): stop default Lagawe snapping / recenter loops
  const DEFAULT_PICKUP_LAT = "16.7999";
  const DEFAULT_PICKUP_LNG = "121.1175";

  // Marks that pickup was changed away from defaults (manual OR auto once from geolocation)
  const pickupTouchedRef = React.useRef<boolean>(false);

  // Track map user interaction to avoid forced recenter during drag/zoom/tap flows
  const mapUserMovedRef = React.useRef<boolean>(false);
  const mapLastRecenterKeyRef = React.useRef<string>("");
  const showMapPrevRef = React.useRef<boolean>(false);

  React.useEffect(() => {
    const isDefault =
      String(pickupLat) === DEFAULT_PICKUP_LAT &&
      String(pickupLng) === DEFAULT_PICKUP_LNG;

    if (!isDefault) pickupTouchedRef.current = true;
  }, [pickupLat, pickupLng]);

'@

$txt2 = [regex]::Replace($txt, $stateBlockPattern, $insertGuards, 1)
if ($txt2 -eq $txt) { throw "Injection failed: state guard block not inserted." }
$txt = $txt2
Write-Host "[OK] Inserted ISSUE#2 guard refs after pickup/drop state."

# ---------- 2) One-time pickup init from geolocation (only if still default) ----------
$geoCheckedAnchor = 'const \[geoCheckedAt, setGeoCheckedAt\] = React\.useState<number \| null>\(null\);'
if ($txt -notmatch $geoCheckedAnchor) {
  throw "Anchor missing: geoCheckedAt state line."
}

$geoInitBlock = @'
const [geoCheckedAt, setGeoCheckedAt] = React.useState<number | null>(null);

  // JRIDE ISSUE#2 (UI-only): Use device geolocation as initial pickup ONCE
  // - Only applies if pickup is still the default Lagawe coordinates
  // - Never overrides a user-selected pickup
  React.useEffect(() => {
    try {
      if (!Number.isFinite(geoLat as any) || !Number.isFinite(geoLng as any)) return;
      if (pickupTouchedRef.current) return;

      const isDefault =
        String(pickupLat) === DEFAULT_PICKUP_LAT &&
        String(pickupLng) === DEFAULT_PICKUP_LNG;

      if (isDefault) {
        setPickupLat(String(geoLat));
        setPickupLng(String(geoLng));
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoLat, geoLng]);

'@

$txt2 = [regex]::Replace($txt, $geoCheckedAnchor, $geoInitBlock, 1)
if ($txt2 -eq $txt) { throw "Injection failed: geo->pickup effect not inserted." }
$txt = $txt2
Write-Host "[OK] Inserted one-time geo->pickup initializer."

# ---------- 3) Prevent recenter loop in Map picker effect ----------
# 3a) Add open/prev logic after centerLat calc
$centerCalcAnchor = 'const centerLat = toNum\(pickupLat, 16\.7999\);'
if ($txt -notmatch $centerCalcAnchor) {
  throw "Anchor missing: centerLat calculation inside initMap()."
}

$centerCalcReplacement = @'
const centerLat = toNum(pickupLat, 16.7999);

      // JRIDE ISSUE#2: when opening the map picker, allow one recenter; after that do not fight the user.
      const openedNow = showMapPicker && !showMapPrevRef.current;
      if (openedNow) {
        mapUserMovedRef.current = false;
        mapLastRecenterKeyRef.current = "";
      }
      showMapPrevRef.current = showMapPicker;
'@

$txt2 = [regex]::Replace($txt, $centerCalcAnchor, $centerCalcReplacement, 1)
if ($txt2 -eq $txt) { throw "Injection failed: openedNow guard not inserted." }
$txt = $txt2
Write-Host "[OK] Inserted openedNow recenter guard."

# 3b) Add map interaction listeners right after NavigationControl
$navControlAnchor = 'mapRef\.current\.addControl\(new MapboxGL\.NavigationControl\(\), "top-right"\);'
if ($txt -notmatch $navControlAnchor) {
  throw "Anchor missing: NavigationControl addControl()"
}

$navControlReplacement = @'
mapRef.current.addControl(new MapboxGL.NavigationControl(), "top-right");

        // JRIDE ISSUE#2: mark user interaction so we don't force-recenter after taps/drags
        try {
          mapUserMovedRef.current = false;

          mapRef.current.on("dragstart", () => { mapUserMovedRef.current = true; });
          mapRef.current.on("zoomstart", () => { mapUserMovedRef.current = true; });
          mapRef.current.on("rotatestart", () => { mapUserMovedRef.current = true; });
          mapRef.current.on("pitchstart", () => { mapUserMovedRef.current = true; });
        } catch {
          // ignore
        }
'@

$txt2 = [regex]::Replace($txt, $navControlAnchor, $navControlReplacement, 1)
if ($txt2 -eq $txt) { throw "Injection failed: map interaction listeners not inserted." }
$txt = $txt2
Write-Host "[OK] Inserted map interaction listeners."

# 3c) Replace the "Recenter map when toggled" else-block with a guarded recenter
$recenterBlockPattern = '(?s)\}\s*else\s*\{\s*// Recenter map when toggled\s*try\s*\{\s*mapRef\.current\.setCenter\(\[centerLng,\s*centerLat\]\);\s*\}\s*catch\s*\{\s*// ignore\s*\}\s*\}'
if ($txt -notmatch $recenterBlockPattern) {
  throw "Could not find the existing recenter else-block (expected: // Recenter map when toggled)."
}

$recenterBlockReplacement = @'
      } else {
        // JRIDE ISSUE#2: do NOT recenter on every state change (prevents snap-back to Lagawe)
        // Only recenter when opening picker or switching mode, AND only if user hasn't moved the map.
        try {
          const key = String(showMapPicker) + ":" + String(pickMode || "");
          const allowRecenter = !mapUserMovedRef.current && (mapLastRecenterKeyRef.current !== key);

          if (allowRecenter) {
            mapLastRecenterKeyRef.current = key;
            mapRef.current.setCenter([centerLng, centerLat]);
          }
        } catch {
          // ignore
        }
      }
'@

$txt2 = [regex]::Replace($txt, $recenterBlockPattern, $recenterBlockReplacement, 1)
if ($txt2 -eq $txt) { throw "Replacement failed: recenter else-block unchanged." }
$txt = $txt2
Write-Host "[OK] Replaced recenter loop with guarded recenter logic."

# ---------- Write file (UTF-8, no BOM) ----------
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($FILE, $txt, $utf8NoBom)
Write-Host "[OK] Patched: $FILE"

Write-Host ""
Write-Host "NEXT:"
Write-Host "1) Build"
Write-Host "2) Quick test: open /ride, enable location, open map picker, tap pickup/dropoff, ensure map does not snap back."
