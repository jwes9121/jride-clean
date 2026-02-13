# PATCH-JRIDE_PHASE12C1_FIXES_NO_HERESTRINGS.ps1
# PowerShell 5.x, ASCII-only
# Patches ONLY: app/ride/page.tsx
# Fixes: Clear unlock + blue route line + send vehicle/pax with fallback + UI vs API probe

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$RepoRoot = Get-Location
$FileRel  = "app\ride\page.tsx"
$FilePath = Join-Path $RepoRoot $FileRel
if (!(Test-Path $FilePath)) { Fail "File not found: $FilePath (Run from repo root.)" }

$ts  = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$FilePath.bak.$ts"
Copy-Item -LiteralPath $FilePath -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $FilePath -Raw

# A) Insert clearRideUi() helper (once), after clampPax()
if ($txt.IndexOf("function clearRideUi()") -lt 0) {
  $reClampEnd = '(?s)(function\s+clampPax\(v:\s*string,\s*raw:\s*string\):\s*string\s*\{.*?\n\s*\}\n)'
  if (-not [regex]::IsMatch($txt, $reClampEnd)) { Fail "Could not locate clampPax() block to insert clearRideUi()." }

  $clearBlock = [string]::Join("
", @(
    "",
    "  function clearRideUi() {",
    "    setResult(\"\"\);",
    "    setActiveCode(\"\"\);",
    "    setLiveStatus(\"\"\);",
    "    setLiveDriverId(\"\"\);",
    "    setLiveUpdatedAt(null);",
    "    setLiveErr(\"\"\);",
    "    setGeoErr(\"\"\);",
    "    setGeoFrom([]);",
    "    setGeoTo([]);",
    "    setSelectedGeoFromId(\"\"\);",
    "    setSelectedGeoToId(\"\"\);",
    "    setActiveGeoField(null);",
    "    setRouteErr(\"\"\);",
    "    setRouteInfo(null);",
    "  }",
    ""
  ))

  $txt = [regex]::Replace($txt, $reClampEnd, '$1' + $clearBlock, 1)
  Write-Host "[OK] Inserted clearRideUi()."
} else {
  Write-Host "[OK] clearRideUi() already present; skipping."
}

# B) Wire main Clear button to clearRideUi()
$reMainClear = 'onClick=\{\(\)\s*=>\s*setResult\(""\)\s*\}'
if ([regex]::IsMatch($txt, $reMainClear)) {
  $txt = [regex]::Replace($txt, $reMainClear, 'onClick={() => clearRideUi()}', 1)
  Write-Host "[OK] Main Clear button now calls clearRideUi()."
} else {
  Write-Host "[WARN] Main Clear handler setResult(\"\") not found (may already be changed)."
}

# C) Wire Trip status Clear button to clearRideUi()
$reTripClear = '(?s)onClick=\{\(\)\s*=>\s*\{\s*setActiveCode\(""\);\s*setLiveStatus\(""\);\s*setLiveDriverId\(""\);\s*setLiveUpdatedAt\(null\);\s*setLiveErr\(""\);\s*\}\s*\}'
if ([regex]::IsMatch($txt, $reTripClear)) {
  $txt = [regex]::Replace($txt, $reTripClear, 'onClick={() => clearRideUi()}', 1)
  Write-Host "[OK] Trip status Clear button now calls clearRideUi()."
} else {
  Write-Host "[OK] Trip status Clear handler block not found (may already be changed)."
}

# D) Route polyline color -> blue
$paintOld = 'paint: { "line-width": 4, "line-opacity": 0.85 }'
$paintNew = 'paint: { "line-width": 4, "line-opacity": 0.85, "line-color": "#2563eb" }'
if ($txt.IndexOf($paintOld) -ge 0) {
  $txt = $txt.Replace($paintOld, $paintNew)
  Write-Host "[OK] Set route polyline color to blue."
} elseif ($txt.IndexOf('"line-color"') -ge 0) {
  Write-Host "[OK] Route polyline already has line-color; skipping."
} else {
  Fail "Could not find route line paint anchor to set color."
}

# E) Replace booking call to send vehicle_type/passenger_count with fallback retry
$reBookBlock = '(?s)\s*const\s+book\s*=\s*await\s+postJson\("/api/public/passenger/book",\s*\{\s*passenger_name:\s*passengerName,\s*town,\s*from_label:\s*fromLabel,\s*to_label:\s*toLabel,\s*pickup_lat:\s*numOrNull\(pickupLat\),\s*pickup_lng:\s*numOrNull\(pickupLng\),\s*dropoff_lat:\s*numOrNull\(dropLat\),\s*dropoff_lng:\s*numOrNull\(dropLng\),\s*service:\s*"ride",\s*\}\s*\);\s*'
if (-not [regex]::IsMatch($txt, $reBookBlock)) {
  Fail "Could not locate exact booking payload block for replacement."
}

$bookNew = [string]::Join("
", @(
  "",
  "      const vSel = (vehicleType === \"motorcycle\") ? \"motorcycle\" : \"tricycle\";",
  "      const paxSel = Number(clampPax(vSel, passengerCount));",
  "",
  "      const payloadBase: any = {",
  "        passenger_name: passengerName,",
  "        town,",
  "        from_label: fromLabel,",
  "        to_label: toLabel,",
  "        pickup_lat: numOrNull(pickupLat),",
  "        pickup_lng: numOrNull(pickupLng),",
  "        dropoff_lat: numOrNull(dropLat),",
  "        dropoff_lng: numOrNull(dropLng),",
  "        service: \"ride\",",
  "      };",
  "",
  "      // Try sending vehicle/pax if backend supports it; if rejected, retry without (so booking still works)",
  "      let book = await postJson(\"/api/public/passenger/book\", {",
  "        ...payloadBase,",
  "        vehicle_type: vSel,",
  "        passenger_count: paxSel,",
  "      });",
  "",
  "      if (!book.ok && (book.status === 400 || book.status === 422)) {",
  "        book = await postJson(\"/api/public/passenger/book\", payloadBase);",
  "      }",
  ""
))

$txt = [regex]::Replace($txt, $reBookBlock, $bookNew, 1)
Write-Host "[OK] Booking now sends vehicle_type/passenger_count with fallback retry."

# F) Replace Phase 12B probe block to print UI vs API values
if ($txt.IndexOf("PHASE12B_BACKEND_PROBE") -lt 0) { Fail "Anchor not found: PHASE12B_BACKEND_PROBE block" }

$reProbe = '(?s)//\s*PHASE12B_BACKEND_PROBE.*?catch\s*\{\s*lines\.push\("vehicle_type/passenger_count: \(probe error\)"\);\s*\}\s*'
if (-not [regex]::IsMatch($txt, $reProbe)) { Fail "Could not locate Phase 12B probe block for replacement." }

$probeNew = [string]::Join("
", @(
"      // PHASE12B_BACKEND_PROBE (read-only): show UI-selected values and what API returned",
"      try {",
"        const uiV = (vehicleType === \"motorcycle\") ? \"motorcycle\" : \"tricycle\";",
"        const uiP = String(clampPax(uiV, passengerCount));",
"",
"        lines.push(\"ui_vehicle_type: \" + uiV);",
"        lines.push(\"ui_passenger_count: \" + uiP);",
"",
"        const b: any = (bj && ((bj as any).booking || bj)) as any;",
"        const vtRaw: any = b ? (b.vehicle_type || b.vehicleType) : \"\";",
"        const pcRaw: any = b ? (b.passenger_count ?? b.passengerCount) : \"\";",
"",
"        const vt = String(vtRaw || \"\").trim();",
"        const pc = (pcRaw === null || pcRaw === undefined || pcRaw === \"\") ? \"\" : String(pcRaw).trim();",
"",
"        lines.push(\"api_vehicle_type: \" + (vt || \"(none)\"));",
"        lines.push(\"api_passenger_count: \" + (pc || \"(none)\"));",
"      } catch {",
"        lines.push(\"vehicle_type/passenger_count: (probe error)\");",
"      }"
))

$txt = [regex]::Replace($txt, $reProbe, $probeNew, 1)
Write-Host "[OK] Probe now prints UI vs API values."

Set-Content -LiteralPath $FilePath -Value $txt -Encoding UTF8
Write-Host "[DONE] Patched: $FileRel"
