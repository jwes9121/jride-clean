# PATCH-LIVETRIPS-MAP-FIT-ALL.ps1
# Adds "Show all" button that fits bounds to visibleTrips markers (no selection changes)

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$t = Get-Content -LiteralPath $f -Raw -Encoding UTF8

# 1) Insert fitAllTrips handler before render
$anchor = "// ===== RENDER ====="
if ($t -notmatch [regex]::Escape($anchor)) {
  Fail "Could not find anchor: $anchor"
}

$insert = @'
  // Fit map to all currently visible trips (no selection changes)
  const fitAllTrips = () => {
    const map = mapRef.current;
    if (!map) return;

    const coords: LngLatTuple[] = [];
    for (let i = 0; i < visibleTrips.length; i++) {
      const raw = visibleTrips[i] as any;

      const driverReal = getDriverReal(raw);
      const pickup = getPickup(raw);
      const drop = getDropoff(raw);

      if (pickup) coords.push(pickup);
      if (drop) coords.push(drop);
      if (driverReal) coords.push(driverReal);
    }

    if (coords.length === 0) return;

    // De-duplicate roughly to reduce bounds noise
    const seen = new Set<string>();
    const uniq: LngLatTuple[] = [];
    for (const c of coords) {
      const key = `${c[0].toFixed(5)},${c[1].toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(c);
    }

    if (uniq.length === 1) {
      map.flyTo({ center: uniq[0], zoom: 14, speed: 1.2, essential: true });
      return;
    }

    const b = new mapboxgl.LngLatBounds(uniq[0], uniq[0]);
    for (const c of uniq) b.extend(c);

    // Padding accounts for overlays (top KPIs, left zones, bottom panels, right dispatch)
    map.fitBounds(b, {
      padding: { top: 90, right: 360, bottom: 240, left: 90 },
      maxZoom: 15,
      duration: 800,
    });
  };

'@

$t = $t.Replace($anchor, $insert + $anchor)

# 2) Add "Show all" button next to Reset in the Zone workload panel
$needle = @'
            <button
              type="button"
              onClick={() => setZoneFilter("all")}
              className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
            >
              Reset
            </button>
'@

if ($t -notmatch [regex]::Escape($needle)) {
  Fail "Could not find the exact Reset button block to extend."
}

$replacement = @'
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={fitAllTrips}
                className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                title="Fit map to all visible trips"
              >
                Show all
              </button>
              <button
                type="button"
                onClick={() => setZoneFilter("all")}
                className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
              >
                Reset
              </button>
            </div>
'@

$t = $t.Replace($needle, $replacement)

Set-Content -LiteralPath $f -Value $t -Encoding UTF8
Write-Host "PATCHED: Fit-bounds 'Show all' button added to LiveTripsMap.tsx" -ForegroundColor Green
