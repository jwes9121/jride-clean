# PATCH-JRIDE_PHASE11C_STEP2_ROUTE_PREVIEW_POLYLINE.ps1
# PowerShell 5.x, ASCII-only
# Patches ONLY: app/ride/page.tsx

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$RepoRoot = Get-Location
$FileRel = "app\ride\page.tsx"
$FilePath = Join-Path $RepoRoot $FileRel
if (!(Test-Path $FilePath)) { Fail "File not found: $FilePath (Run from repo root.)" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$FilePath.bak.$ts"
Copy-Item -LiteralPath $FilePath -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $FilePath -Raw

# --- Anchors ---
if ($txt.IndexOf('const dropoffMarkerRef = React.useRef<any>(null);') -lt 0) { Fail "Anchor not found: dropoffMarkerRef" }
if ($txt.IndexOf('// Map picker init / refresh') -lt 0) { Fail "Anchor not found: Map picker init / refresh" }
if ($txt.IndexOf('mapRef.current = new MapboxGL.Map({') -lt 0) { Fail "Anchor not found: MapboxGL.Map init" }
if ($txt.IndexOf('mapRef.current.on("click", async (e: any) => {') -lt 0) { Fail "Anchor not found: map click handler" }
if ($txt.IndexOf('async function geocodeReverse(lng: number, lat: number): Promise<string> {') -lt 0) { Fail "Anchor not found: geocodeReverse header" }

# --- 1) Insert route preview state/refs right after marker refs ---
$anchor1 = 'const dropoffMarkerRef = React.useRef<any>(null);'
if ($txt.IndexOf("routeGeoRef") -lt 0) {
  $ins1 = @'
const dropoffMarkerRef = React.useRef<any>(null);

  // ===== Route preview polyline (UI-only) =====
  const ROUTE_SOURCE_ID = "jride_route_source";
  const ROUTE_LAYER_ID = "jride_route_line";
  const routeAbortRef = React.useRef<any>(null);
  const routeDebounceRef = React.useRef<any>(null);
  const [routeErr, setRouteErr] = React.useState<string>("");
  const [routeInfo, setRouteInfo] = React.useState<{ distance_m: number; duration_s: number } | null>(null);
  const routeGeoRef = React.useRef<any>({
    type: "FeatureCollection",
    features: [],
  });

  function hasBothPoints(): boolean {
    const plng = toNum(pickupLng, 121.1175);
    const plat = toNum(pickupLat, 16.7999);
    const dlng = toNum(dropLng, 121.1222);
    const dlat = toNum(dropLat, 16.8016);
    return Number.isFinite(plng) && Number.isFinite(plat) && Number.isFinite(dlng) && Number.isFinite(dlat);
  }

  function emptyRouteGeo(): any {
    return { type: "FeatureCollection", features: [] };
  }

  function ensureRouteLayer(map: any) {
    try {
      if (!map) return;
      if (!map.getSource(ROUTE_SOURCE_ID)) {
        map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: routeGeoRef.current });
      }
      if (!map.getLayer(ROUTE_LAYER_ID)) {
        map.addLayer({
          id: ROUTE_LAYER_ID,
          type: "line",
          source: ROUTE_SOURCE_ID,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-width": 4, "line-opacity": 0.85 },
        });
      }
    } catch {
      // ignore
    }
  }

  function pushRouteToMap(map: any, geo: any) {
    try {
      if (!map) return;
      const src = map.getSource(ROUTE_SOURCE_ID);
      if (src && src.setData) src.setData(geo);
    } catch {
      // ignore
    }
  }

  async function fetchRouteAndUpdate() {
    setRouteErr("");

    if (!MAPBOX_TOKEN) {
      setRouteErr("Route preview requires Mapbox token.");
      setRouteInfo(null);
      routeGeoRef.current = emptyRouteGeo();
      if (mapRef.current) pushRouteToMap(mapRef.current, routeGeoRef.current);
      return;
    }

    if (!hasBothPoints()) {
      setRouteInfo(null);
      routeGeoRef.current = emptyRouteGeo();
      if (mapRef.current) pushRouteToMap(mapRef.current, routeGeoRef.current);
      return;
    }

    const plng = toNum(pickupLng, 121.1175);
    const plat = toNum(pickupLat, 16.7999);
    const dlng = toNum(dropLng, 121.1222);
    const dlat = toNum(dropLat, 16.8016);

    // Cancel in-flight request
    try {
      if (routeAbortRef.current) routeAbortRef.current.abort();
    } catch {
      // ignore
    }
    const ac = new AbortController();
    routeAbortRef.current = ac;

    // Directions API (no traffic for now; can switch to driving-traffic later)
    const coords = String(plng) + "," + String(plat) + ";" + String(dlng) + "," + String(dlat);
    const url =
      "https://api.mapbox.com/directions/v5/mapbox/driving/" +
      encodeURIComponent(coords) +
      "?geometries=geojson&overview=simplified&alternatives=false&access_token=" +
      encodeURIComponent(MAPBOX_TOKEN);

    try {
      const r = await fetch(url, { method: "GET", signal: ac.signal });
      const j = (await r.json().catch(() => ({}))) as any;

      if (!r.ok) {
        setRouteErr("Directions failed: HTTP " + String(r.status));
        setRouteInfo(null);
        routeGeoRef.current = emptyRouteGeo();
        if (mapRef.current) pushRouteToMap(mapRef.current, routeGeoRef.current);
        return;
      }

      const route0 = (j && j.routes && Array.isArray(j.routes) && j.routes.length) ? j.routes[0] : null;
      const geom = route0 && route0.geometry ? route0.geometry : null;

      if (!geom || !geom.coordinates || !Array.isArray(geom.coordinates) || geom.coordinates.length < 2) {
        setRouteErr("Directions returned no route geometry.");
        setRouteInfo(null);
        routeGeoRef.current = emptyRouteGeo();
        if (mapRef.current) pushRouteToMap(mapRef.current, routeGeoRef.current);
        return;
      }

      const geo = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: geom,
          },
        ],
      };

      routeGeoRef.current = geo;
      setRouteInfo({
        distance_m: Number(route0.distance || 0),
        duration_s: Number(route0.duration || 0),
      });

      if (mapRef.current) {
        ensureRouteLayer(mapRef.current);
        pushRouteToMap(mapRef.current, geo);
      }
    } catch (e: any) {
      const msg = String(e && e.name ? e.name : "") === "AbortError" ? "" : String(e?.message || e);
      if (msg) setRouteErr("Directions error: " + msg);
      setRouteInfo(null);
      routeGeoRef.current = emptyRouteGeo();
      if (mapRef.current) pushRouteToMap(mapRef.current, routeGeoRef.current);
    }
  }

'@

  $txt = $txt.Replace($anchor1, $ins1)
  Write-Host "[OK] Inserted route preview helpers/states."
} else {
  Write-Host "[OK] Route preview helpers already present; skipping insert."
}

# --- 2) Ensure route source/layer added on map load, and update route after map appears ---
# Add to map creation block: after mapRef.current.addControl(...) we attach a 'load' handler to ensure source/layer.
$anchor2 = 'mapRef.current.addControl(new MapboxGL.NavigationControl(), "top-right");'
if ($txt.IndexOf('mapRef.current.on("load"', $txt.IndexOf($anchor2)) -lt 0) {
  $rep2 = @'
mapRef.current.addControl(new MapboxGL.NavigationControl(), "top-right");

        mapRef.current.on("load", () => {
          try {
            ensureRouteLayer(mapRef.current);
            // Push current route state (may be empty)
            pushRouteToMap(mapRef.current, routeGeoRef.current);
          } catch {
            // ignore
          }
        });
'@
  $txt = $txt.Replace($anchor2, $rep2)
  Write-Host "[OK] Added map load handler to ensure route layer/source."
} else {
  Write-Host "[OK] Map load handler already present; skipping."
}

# --- 3) Add an effect to fetch route when both points are set and map is visible ---
# Insert right after the Map picker init/refresh effect block ends (anchor: end of that effect is "}, [showMapPicker, pickMode, pickupLat, pickupLng, dropLat, dropLng]);")
$anchor3 = '}, [showMapPicker, pickMode, pickupLat, pickupLng, dropLat, dropLng]);'
if ($txt.IndexOf($anchor3) -lt 0) { Fail "Anchor not found: map picker effect dependency line" }

if ($txt.IndexOf("Route preview fetch effect") -lt 0) {
  $ins3 = @'
}, [showMapPicker, pickMode, pickupLat, pickupLng, dropLat, dropLng]);

  // Route preview fetch effect (UI-only)
  React.useEffect(() => {
    if (!showMapPicker) return;

    // Ensure layer exists if map already initialized
    try {
      if (mapRef.current) ensureRouteLayer(mapRef.current);
    } catch {
      // ignore
    }

    if (routeDebounceRef.current) clearTimeout(routeDebounceRef.current);

    // Only fetch when both pickup + dropoff are set
    if (!hasBothPoints()) {
      setRouteInfo(null);
      routeGeoRef.current = emptyRouteGeo();
      if (mapRef.current) pushRouteToMap(mapRef.current, routeGeoRef.current);
      return;
    }

    routeDebounceRef.current = setTimeout(async () => {
      await fetchRouteAndUpdate();
    }, 350);

    return () => {
      if (routeDebounceRef.current) clearTimeout(routeDebounceRef.current);
      routeDebounceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMapPicker, pickupLat, pickupLng, dropLat, dropLng, MAPBOX_TOKEN]);

'@
  $txt = $txt.Replace($anchor3, $ins3)
  Write-Host "[OK] Inserted route preview fetch effect."
} else {
  Write-Host "[OK] Route preview fetch effect already present; skipping."
}

# --- 4) Show a small UI hint under the map picker header (non-invasive) ---
# Insert a route info line in the map picker panel header (safe, optional).
$hdrAnchor = 'Tap the map to set {pickMode}. Markers: green pickup, red dropoff.'
if ($txt.IndexOf($hdrAnchor) -ge 0 -and $txt.IndexOf("Route preview:", $txt.IndexOf($hdrAnchor)) -lt 0) {
  $repHdr = @'
Tap the map to set {pickMode}. Markers: green pickup, red dropoff.
                  {hasBothPoints() ? (
                    <span className="ml-2">
                      Route preview: {routeInfo ? (Math.round(routeInfo.distance_m / 10) / 100) + " km, " + Math.round(routeInfo.duration_s / 60) + " min" : "loading..."}
                      {routeErr ? (" | " + routeErr) : ""}
                    </span>
                  ) : (
                    <span className="ml-2">Route preview: set both pickup and dropoff.</span>
                  )}
'@
  $txt = $txt.Replace($hdrAnchor, $repHdr)
  Write-Host "[OK] Added route preview UI hint in map header."
} else {
  Write-Host "[OK] Map header hint already present or header anchor not found; skipping."
}

Set-Content -LiteralPath $FilePath -Value $txt -Encoding UTF8
Write-Host "[DONE] Patched: $FileRel"
