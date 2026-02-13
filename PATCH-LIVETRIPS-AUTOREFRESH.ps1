# PATCH-LIVETRIPS-AUTOREFRESH.ps1
# Adds auto-refresh polling to LiveTripsClient.tsx without relying on function names

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$t = Get-Content -LiteralPath $f -Raw -Encoding UTF8

# Find the first useEffect with empty deps: useEffect(() => { ... }, []);
$rxFirstEffect = '(?s)useEffect\s*\(\s*\(\)\s*=>\s*\{.*?\}\s*,\s*\[\s*\]\s*\)\s*;'
$m = [regex]::Match($t, $rxFirstEffect)
if (!$m.Success) {
  Fail "Could not locate initial useEffect(() => { ... }, []) in LiveTripsClient.tsx"
}

$pollBlock = @"

  // ===== Auto-refresh polling (no flicker) =====
  useEffect(() => {
    let alive = true;
    let timer: any = null;
    let inflight: AbortController | null = null;

    async function tick() {
      if (!alive) return;

      // Pause polling when tab is hidden
      if (typeof document !== "undefined" && document.hidden) {
        timer = setTimeout(tick, 12000);
        return;
      }

      // Avoid overlapping requests
      if (inflight) {
        timer = setTimeout(tick, 12000);
        return;
      }

      inflight = new AbortController();
      try {
        const r = await fetch("/api/admin/livetrips/page-data", {
          cache: "no-store",
          signal: inflight.signal,
        });
        const j = await r.json();

        if (!alive) return;

        if (j?.ok && j?.data) {
          const nextTrips = j.data.trips || [];
          const nextDrivers = j.data.drivers || [];
          const nextZones = j.data.zones || [];

          setAllTrips((prev: any) => {
            try {
              return JSON.stringify(prev) === JSON.stringify(nextTrips)
                ? prev
                : nextTrips;
            } catch {
              return nextTrips;
            }
          });

          setDrivers((prev: any) => {
            try {
              return JSON.stringify(prev) === JSON.stringify(nextDrivers)
                ? prev
                : nextDrivers;
            } catch {
              return nextDrivers;
            }
          });

          setZones((prev: any) => {
            try {
              return JSON.stringify(prev) === JSON.stringify(nextZones)
                ? prev
                : nextZones;
            } catch {
              return nextZones;
            }
          });
        }
      } catch {
        // ignore polling errors
      } finally {
        inflight = null;
        if (alive) timer = setTimeout(tick, 12000);
      }
    }

    timer = setTimeout(tick, 6000);
    return () => {
      alive = false;
      try { if (timer) clearTimeout(timer); } catch {}
      try { inflight?.abort(); } catch {}
      inflight = null;
    };
  }, []);
"@

# Insert polling block AFTER the first initial-load effect
$t2 = $t.Insert($m.Index + $m.Length, $pollBlock)

Set-Content -LiteralPath $f -Value $t2 -Encoding UTF8
Write-Host "PATCHED: Auto-refresh polling added to LiveTripsClient.tsx" -ForegroundColor Green
