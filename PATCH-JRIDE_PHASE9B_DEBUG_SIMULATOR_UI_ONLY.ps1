# PATCH-JRIDE_PHASE9B_DEBUG_SIMULATOR_UI_ONLY.ps1
# Adds debug-only buttons (?debug=1) to inject/clear a TEST problem trip for validating Phase 9B cooldown.
# ASCII only. PowerShell 5 compatible. No Mapbox file edits. One file only.

$ErrorActionPreference = "Stop"
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Fail($m){ throw $m }

$path = Join-Path (Get-Location) "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $path)) { Fail "File not found: $path" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$stamp"
Copy-Item $path $bak -Force
Ok "Backup: $bak"

$txt = Get-Content $path -Raw

# 1) Insert debug flag state after lastAction (safe anchor exists)
$anchor1 = '  const [lastAction, setLastAction] = useState<string>("");'
if ($txt -notmatch [regex]::Escape($anchor1)) { Fail "Anchor not found: lastAction state" }

$insert1 = @"
$anchor1

  // ===== PHASE 9B DEBUG SIMULATOR (UI-only) =====
  // Enabled only on /admin/livetrips?debug=1
  const [uiDebug, setUiDebug] = useState<boolean>(false);

"@
$txt = $txt.Replace($anchor1, $insert1)
Ok "Inserted uiDebug state."

# 2) Set uiDebug inside initial mount useEffect (anchor is the existing useEffect)
$anchor2 = @"
  useEffect(() => {
    loadPage().catch((e) => setLastAction(String(e?.message || e)));
    loadDrivers().catch(() => {});
  }, []);
"@
if ($txt -notmatch [regex]::Escape($anchor2)) { Fail "Anchor not found: initial mount useEffect" }

$insert2 = @"
  useEffect(() => {
    loadPage().catch((e) => setLastAction(String(e?.message || e)));
    loadDrivers().catch(() => {});
    try {
      const qs = new URLSearchParams(window.location.search || "");
      setUiDebug(qs.get("debug") === "1");
    } catch {}
  }, []);
"@
$txt = $txt.Replace($anchor2, $insert2)
Ok "Patched mount useEffect to enable uiDebug via ?debug=1."

# 3) Add helper functions inside component (place after setFilterAndFocus for stability)
$anchor3 = @"
  function setFilterAndFocus(f: FilterKey) {
    setTripFilter(f);
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }
"@
if ($txt -notmatch [regex]::Escape($anchor3)) { Fail "Anchor not found: setFilterAndFocus" }

$insert3 = @"
  function setFilterAndFocus(f: FilterKey) {
    setTripFilter(f);
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function addDebugProblemTrip() {
    const now = Date.now();
    const key = "TEST-UI-" + String(now);
    const oldIso = new Date(now - (20 * 60 * 1000)).toISOString(); // 20 minutes ago => stale
    const fake: any = {
      id: key,
      uuid: key,
      booking_code: key,
      status: "on_the_way",
      town: "Lagawe",
      passenger_name: "Test Passenger",
      pickup_label: "DEBUG Pickup (Lagawe)",
      dropoff_label: "DEBUG Dropoff (Lagawe)",
      // Valid coordinates near Lagawe so map stays safe
      pickup_lat: 16.805,
      pickup_lng: 121.104,
      dropoff_lat: 16.810,
      dropoff_lng: 121.112,
      driver_id: "DEBUG_DRIVER_1",
      created_at: oldIso,
      updated_at: oldIso,
      _ui_debug: true,
    };
    setAllTrips((prev) => [fake, ...(prev || [])]);
    setLastAction("DEBUG: added PROBLEM trip " + key);
    setTripFilter("dispatch");
  }

  function clearDebugTrips() {
    setAllTrips((prev) => (prev || []).filter((t: any) => String(t?.booking_code || "").indexOf("TEST-UI-") !== 0));
    setLastAction("DEBUG: cleared TEST-UI trips");
  }

"@
$txt = $txt.Replace($anchor3, $insert3)
Ok "Inserted debug trip helpers."

# 4) Add debug buttons near "Refresh now" button (keeps layout minimal)
$needle4 = 'onClick={() => loadPage()}'
$pos = $txt.IndexOf($needle4)
if ($pos -lt 0) { Fail "Could not find Refresh now button onClick anchor." }

# Find the closing </button> of Refresh now and insert debug buttons after it
$refreshBtnPattern = '(?s)(<button\s+[^>]*onClick=\{\(\)\s*=>\s*loadPage\(\)\}[^>]*>[\s\S]*?Refresh now[\s\S]*?</button>)'
$m = [regex]::Match($txt, $refreshBtnPattern)
if (!$m.Success) { Fail "Could not locate Refresh now button block." }

$refreshBlock = $m.Groups[1].Value
$injectButtons = @"
$refreshBlock

                {uiDebug ? (
                  <>
                    <button
                      className="rounded border px-3 py-1 text-sm hover:bg-gray-50"
                      onClick={() => addDebugProblemTrip()}
                      title="UI-only: inject a stale on_the_way trip (valid coords) to test Phase 9B"
                    >
                      Add TEST PROBLEM
                    </button>
                    <button
                      className="rounded border px-3 py-1 text-sm hover:bg-gray-50"
                      onClick={() => clearDebugTrips()}
                      title="Remove TEST-UI-* trips"
                    >
                      Clear TEST trips
                    </button>
                  </>
                ) : null}

"@
$txt = $txt.Replace($refreshBlock, $injectButtons)
Ok "Inserted debug buttons next to Refresh now (debug=1 only)."

Set-Content -Path $path -Value $txt -Encoding UTF8
Ok "Patched: $path"
Ok "Done."
