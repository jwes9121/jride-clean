# PATCH-JRIDE_TRACK_MAPBOX_MARKERS_V1.ps1
# Adds Mapbox GL markers: pickup, dropoff, driver (live). PS5-safe.

$ErrorActionPreference="Stop"
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red; throw $m }
function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

$root = (Get-Location).Path
if (!(Test-Path (Join-Path $root "package.json"))) { Fail "Run from repo root (package.json)." }

$trackClient = Join-Path $root "app\ride\track\TrackClient.tsx"
if (!(Test-Path $trackClient)) { Fail "Missing: $trackClient" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $root "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir ("TrackClient.tsx.bak.{0}" -f $ts)
Copy-Item -Force $trackClient $bak
Ok "[OK] Backup: $bak"

$src = Get-Content -Raw -Path $trackClient

if ($src -match "JRIDE_MAPBOX_MARKERS_BEGIN") {
  Warn "[SKIP] Mapbox markers patch already applied."
  Ok "=== DONE (no changes) ==="
  exit 0
}

# Ensure React hooks exist
if ($src -notmatch "useEffect" -or $src -notmatch "useRef") {
  Warn "[WARN] TrackClient.tsx structure differs; patch may fail if hooks are missing."
}

# Inject Map container and JS logic by replacing the "Map" placeholder block message.
# Anchor: the existing warning text "Mapbox token missing"
$anchor = "Mapbox token missing"
if ($src -notmatch [regex]::Escape($anchor)) {
  Fail "Anchor not found: 'Mapbox token missing' in TrackClient.tsx"
}

# 1) Add refs/effect block near top of component after state declarations.
# We insert after the first occurrence of "const token" if present; otherwise after "function TrackClient" line.
$insertPoint = $null
if ($src -match "const\s+token\s*=") {
  $insertPoint = [regex]::Match($src, "const\s+token\s*=").Index
} else {
  $m = [regex]::Match($src, "function\s+TrackClient")
  if (!$m.Success) { Fail "Could not find function TrackClient anchor." }
  $insertPoint = $m.Index
}

$mapLogic = @'
  // JRIDE_MAPBOX_MARKERS_BEGIN
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<{ pickup?: any; dropoff?: any; driver?: any }>({});

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (!token) return;
      if (!mapContainerRef.current) return;

      try {
        const mapboxgl = (await import("mapbox-gl")).default as any;
        mapboxgl.accessToken = token;

        if (cancelled) return;

        if (!mapRef.current) {
          mapRef.current = new mapboxgl.Map({
            container: mapContainerRef.current,
            style: "mapbox://styles/mapbox/streets-v12",
            center: [121.15, 16.73],
            zoom: 12,
          });

          mapRef.current.addControl(new mapboxgl.NavigationControl(), "top-right");
        }
      } catch (e) {
        console.error("Mapbox init failed", e);
      }
    }

    boot();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    // Update markers whenever booking data changes
    const m = mapRef.current;
    if (!m) return;
    if (!token) return;

    // These vars are expected from existing TrackClient state:
    // pickupLat, pickupLng, dropoffLat, dropoffLng, driverLat, driverLng
    const pts: Array<[number, number]> = [];

    function upsert(name: "pickup" | "dropoff" | "driver", lng: number, lat: number) {
      try {
        const mapboxgl = (require("mapbox-gl") as any).default || (require("mapbox-gl") as any);
        const existing = markersRef.current[name];
        if (existing) {
          existing.setLngLat([lng, lat]);
        } else {
          const el = document.createElement("div");
          el.style.width = "14px";
          el.style.height = "14px";
          el.style.borderRadius = "999px";
          el.style.border = "2px solid white";
          el.style.boxShadow = "0 2px 10px rgba(0,0,0,.25)";
          el.style.background = name === "driver" ? "#111827" : (name === "pickup" ? "#2563eb" : "#dc2626");

          markersRef.current[name] = new mapboxgl.Marker({ element: el })
            .setLngLat([lng, lat])
            .addTo(m);
        }
      } catch (e) {
        console.error("Marker update failed", e);
      }
    }

    try {
      if (typeof pickupLng === "number" && typeof pickupLat === "number") {
        upsert("pickup", pickupLng, pickupLat);
        pts.push([pickupLng, pickupLat]);
      }
      if (typeof dropoffLng === "number" && typeof dropoffLat === "number") {
        upsert("dropoff", dropoffLng, dropoffLat);
        pts.push([dropoffLng, dropoffLat]);
      }
      if (typeof driverLng === "number" && typeof driverLat === "number") {
        upsert("driver", driverLng, driverLat);
        pts.push([driverLng, driverLat]);
      }

      if (pts.length >= 2) {
        const bounds = pts.reduce((b, p) => b.extend(p), new (require("mapbox-gl") as any).LngLatBounds(pts[0], pts[0]));
        m.fitBounds(bounds, { padding: 40, duration: 500 });
      } else if (pts.length === 1) {
        m.easeTo({ center: pts[0], zoom: 14, duration: 500 });
      }
    } catch (e) {
      console.error("Fit bounds failed", e);
    }
  }, [token, pickupLat, pickupLng, dropoffLat, dropoffLng, driverLat, driverLng]);
  // JRIDE_MAPBOX_MARKERS_END

'@

# Insert mapLogic right after the line that declares token (best-effort)
if ($src -match "const\s+token\s*=") {
  $src = [regex]::Replace($src, "(const\s+token\s*=[^\r\n]*\r?\n)", ('$1' + "`r`n" + $mapLogic), 1)
} else {
  # fallback: insert after function TrackClient opening brace
  $src = [regex]::Replace($src, "(function\s+TrackClient[^{]*\{\r?\n)", ('$1' + "`r`n" + $mapLogic), 1)
}

# 2) Replace the placeholder warning panel body with an actual map container (keeps warning if no token).
$src2 = $src -replace [regex]::Escape("Mapbox token missing. Set"), @'
Mapbox token missing. Set
'@

# Add a map container in the Map panel by inserting near the existing "Map" panel content.
# Anchor on the exact "Markers:" hint line (seen in your UI)
$anchor2 = "Markers: A=pickup, B=dropoff, car=driver"
if ($src2 -notmatch [regex]::Escape($anchor2)) {
  Warn "[WARN] Could not find marker hint anchor; map container injection will be appended near the token warning."
  $anchor2 = $anchor
}

$mapDiv = @'
        {/* JRIDE_MAPBOX_CONTAINER_BEGIN */}
        {token ? (
          <div
            ref={mapContainerRef}
            style={{ width: "100%", height: 240, borderRadius: 12, overflow: "hidden" }}
          />
        ) : null}
        {/* JRIDE_MAPBOX_CONTAINER_END */}

'@

$src3 = $src2 -replace [regex]::Escape($anchor2), ($anchor2 + "`r`n`r`n" + $mapDiv)

WriteUtf8NoBom $trackClient $src3
Ok "[OK] Patched: Mapbox markers map container + live marker updates"
Ok "=== DONE: Passenger map markers (driver/pickup/dropoff) ==="
Ok "[NEXT] Set NEXT_PUBLIC_MAPBOX_TOKEN then refresh /ride/track?code=..."
