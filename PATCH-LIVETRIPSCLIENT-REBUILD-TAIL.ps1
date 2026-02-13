# PATCH-LIVETRIPSCLIENT-REBUILD-TAIL.ps1
# Replaces the broken tail of LiveTripsClient.tsx (from <div className="p-3 border-t"> to EOF)
# with a clean, balanced JSX block (left panel footer + right map panel + correct closing tags).

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $f)) { Fail "Missing file: $f" }

$txt  = Get-Content -Raw -Encoding UTF8 $f
$orig = $txt

$anchor = '<div className="p-3 border-t">'
$idx = $txt.IndexOf($anchor)
if ($idx -lt 0) { Fail "Anchor not found: $anchor" }

# Keep everything before the anchor, then append a known-good tail.
$head = $txt.Substring(0, $idx)

$tail = @'
<div className="p-3 border-t">
  <div className="text-xs text-gray-600 mb-2">Drivers: {driversDebug}</div>

  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
    <TripWalletPanel trip={selectedTrip as any} />
    <TripLifecycleActions trip={selectedTrip as any} onAfterAction={() => { loadPage().catch(() => {}); }} />
  </div>

  <div className="mt-3 rounded border p-3">
    <div className="font-semibold mb-2">Assign driver (manual)</div>

    <div className="flex flex-wrap gap-2 items-center">
      <select
        className="border rounded px-2 py-1 text-sm min-w-[320px]"
        value={manualDriverId}
        onChange={(e) => setManualDriverId(e.target.value)}
      >
        <option value="">Select driver</option>
        {drivers.map((d, idx) => {
          const value = String(d.driver_id || (d as any).id || (d as any).uuid || "");
          const label = formatDriverOptionLabel(d, idx);
          return (
            <option key={value || idx} value={value}>
              {label}
            </option>
          );
        })}
      </select>

      <button
        className="rounded bg-black text-white px-3 py-2 text-sm disabled:opacity-50"
        disabled={!selectedTrip?.booking_code || !manualDriverId}
        onClick={() => {
          if (!selectedTrip?.booking_code) return;
          assignDriver(selectedTrip.booking_code, manualDriverId).catch((err) =>
            setLastAction(String(err?.message || err))
          );
        }}
      >
        Assign
      </button>

      <button
        className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
        onClick={() => {
          loadPage().catch(() => {});
          loadDrivers().catch(() => {});
          setLastAction("Refreshed");
        }}
      >
        Refresh now
      </button>
    </div>

    <div className="mt-2">
      <SmartAutoAssignSuggestions
        trip={selectedTrip as any}
        drivers={drivers as any}
        zoneStats={zoneStats as any}
        onAssign={(driverId: string) => {
          const bc =
            (selectedTrip as any)?.booking_code ||
            (selectedTrip as any)?.bookingCode;
          if (!bc) return;
          return assignDriver(String(bc), String(driverId));
        }}
      />
    </div>
  </div>
</div>

        </div>

        <div className="rounded-lg border">
          <div className="p-3 border-b flex items-center justify-between">
            <div className="font-semibold">Map</div>
            <div className="text-xs text-gray-600">
              {selectedTrip?.booking_code ? `Selected: ${selectedTrip.booking_code}` : "No trip selected"}
            </div>
          </div>
          <div className="p-2" style={{ minHeight: 520 }}>
            <LiveTripsMap trips={allTrips as any} selectedTripId={selectedTripId} stuckTripIds={stuckTripIds as any} />
          </div>
        </div>
      </div>
    </div>
  );
}
'@

# IMPORTANT: preserve indentation – the tail includes the needed closing tags for:
# - left panel </div>
# - right panel
# - grid wrapper
# - outer wrapper
# - component end

# Normalize line endings to CRLF for Windows
$out = ($head + $tail) -replace "`r?`n", "`r`n"

# Write UTF-8 no BOM (prevents mojibake)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($f, $out, $utf8NoBom)

Write-Host "OK: Rebuilt LiveTripsClient tail (restored missing closing tags + map panel)." -ForegroundColor Green
Write-Host "Next: remove .next then build." -ForegroundColor Cyan
