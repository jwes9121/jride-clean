# PATCH-JRIDE_PHASE7A_LIVETRIPS_VISUAL_CONFIDENCE.ps1
# PHASE 7A — LiveTrips Visual Confidence (FRONTEND ONLY)
# Touches ONLY:
#   - app\admin\livetrips\LiveTripsClient.tsx
#   - app\admin\livetrips\components\LiveTripsMap.tsx  (or LiveTripsMap.tsx depending on your repo)
#
# NOTE: Your uploaded file path shows LiveTripsMap imported from "./components/LiveTripsMap"
# so repo path is: app\admin\livetrips\components\LiveTripsMap.tsx

$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }

function Backup($p){
  if(!(Test-Path $p)){ Fail "Missing: $p" }
  $bak = "$p.bak.$(Stamp)"
  Copy-Item $p $bak -Force
  Write-Host "[OK] Backup $bak"
}

function ReadRaw($p){
  return Get-Content $p -Raw
}

function WriteUtf8NoBom($p,$c){
  $e = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($p,$c,$e)
  Write-Host "[OK] Wrote $p"
}

# Paths (repo)
$CLIENT_PATH = "app\admin\livetrips\LiveTripsClient.tsx"
$MAP_PATH    = "app\admin\livetrips\components\LiveTripsMap.tsx"

Backup $CLIENT_PATH
Backup $MAP_PATH

# ---------------------------
# Patch 1/2: LiveTripsClient.tsx
# ---------------------------
$txt = ReadRaw $CLIENT_PATH

# Insert helper functions for status badge + freshness (once)
if ($txt -notmatch "function\s+statusBadgeClass\(") {
  $needle = "function computeIsProblem"
  if ($txt -notmatch [regex]::Escape($needle)) { Fail "Could not find anchor 'function computeIsProblem' in $CLIENT_PATH" }

  $insert = @'
function statusBadgeClass(s: string, isProblem: boolean, stale: boolean) {
  const base = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs";
  if (isProblem) return base + " border-red-300 bg-red-50 text-red-700";
  if (stale) return base + " border-amber-300 bg-amber-50 text-amber-800";

  switch (s) {
    case "requested":
    case "pending":
      return base + " border-slate-200 bg-slate-50 text-slate-700";
    case "assigned":
      return base + " border-indigo-200 bg-indigo-50 text-indigo-700";
    case "on_the_way":
      return base + " border-blue-200 bg-blue-50 text-blue-700";
    case "arrived":
      return base + " border-cyan-200 bg-cyan-50 text-cyan-700";
    case "enroute":
      return base + " border-sky-200 bg-sky-50 text-sky-700";
    case "on_trip":
      return base + " border-green-200 bg-green-50 text-green-700";
    case "completed":
      return base + " border-emerald-200 bg-emerald-50 text-emerald-700";
    case "cancelled":
      return base + " border-rose-200 bg-rose-50 text-rose-700";
    default:
      return base + " border-gray-200 bg-gray-50 text-gray-700";
  }
}

function freshnessText(mins: number) {
  if (!Number.isFinite(mins)) return "-";
  if (mins <= 0) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} min ago`;
}

'@

  # Insert right BEFORE computeIsProblem (keeps file structure stable)
  $txt = $txt -replace "(?s)(function\s+computeIsProblem\s*\()", ($insert + "`nfunction computeIsProblem(")
  Write-Host "[OK] Inserted statusBadgeClass + freshnessText helpers."
}

# Add mins/stale computation inside row map (once)
if ($txt -notmatch "const\s+mins\s*=\s*minutesSince") {
  $anchor = "const s = normStatus(t.status);"
  if ($txt -notmatch [regex]::Escape($anchor)) { Fail "Could not find row anchor 'const s = normStatus(t.status);' in $CLIENT_PATH" }

  $txt = $txt -replace [regex]::Escape($anchor), ($anchor + "`n                    const mins = minutesSince(t.updated_at || t.created_at || null);`n                    const stale = isActiveTripStatus(s) && mins >= 3;")
  Write-Host "[OK] Added mins + stale calc per row."
}

# Replace the Status <td> block with color-coded badge + freshness line (exact match)
$oldStatusBlock = @'
                        <td className="p-2">
                          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
                            {s || "—"}
                          </span>
                        </td>
'@

if ($txt -notmatch [regex]::Escape($oldStatusBlock)) {
  Fail "Could not find exact Status <td> block to replace in $CLIENT_PATH (file may differ)."
}

$newStatusBlock = @'
                        <td className="p-2">
                          <div className="flex flex-col">
                            <span className={statusBadgeClass(s, isProblem, stale)}>
                              {s || "—"}
                            </span>
                            <span className={stale ? "text-[10px] text-amber-800 mt-0.5" : "text-[10px] text-gray-500 mt-0.5"}>
                              {stale ? `STALE • ${freshnessText(mins)}` : freshnessText(mins)}
                            </span>
                          </div>
                        </td>
'@

$txt = $txt -replace [regex]::Escape($oldStatusBlock), $newStatusBlock
Write-Host "[OK] Updated Status cell to include visual confidence cues."

WriteUtf8NoBom $CLIENT_PATH $txt


# ---------------------------
# Patch 2/2: LiveTripsMap.tsx
# ---------------------------
$map = ReadRaw $MAP_PATH

# Insert helpers near top (once)
if ($map -notmatch "function\s+statusRingColor\(") {
  $anchor2 = "type LngLatTuple = \\[number, number\\];"
  if ($map -notmatch $anchor2) { Fail "Could not find anchor 'type LngLatTuple' in $MAP_PATH" }

  $helpers = @'
function statusRingColor(s: string): string {
  const x = String(s || "").trim().toLowerCase();
  switch (x) {
    case "requested":
    case "pending": return "#94a3b8";   // slate
    case "assigned": return "#6366f1";  // indigo
    case "on_the_way": return "#3b82f6";// blue
    case "arrived": return "#06b6d4";   // cyan
    case "enroute": return "#0ea5e9";   // sky
    case "on_trip": return "#22c55e";   // green
    case "completed": return "#10b981"; // emerald
    case "cancelled": return "#f43f5e"; // rose
    default: return "#9ca3af";          // gray
  }
}

function minutesSinceIso(iso: any): number {
  if (!iso) return 999999;
  const t = new Date(String(iso)).getTime();
  if (!Number.isFinite(t)) return 999999;
  return Math.floor((Date.now() - t) / 60000);
}

'@

  $map = $map -replace $anchor2, ("type LngLatTuple = [number, number];`n`n" + $helpers)
  Write-Host "[OK] Inserted statusRingColor + minutesSinceIso helpers."
}

# Patch driver marker creation to add colored ring + stale glow
if ($map -notmatch "statusRingColor") { Fail "Helper insertion failed in $MAP_PATH" }

# We patch only the DRIVER marker block where the img element is created.
$markerNeedle = 'el.src = "/icons/jride-trike.png";'
if ($map -notmatch [regex]::Escape($markerNeedle)) { Fail "Could not find trike marker creation line in $MAP_PATH" }

# Add per-trip status + stale detection inside loop (once)
if ($map -notmatch "const\s+statusNorm\s*=") {
  $loopAnchor = "const isStuck = activeStuckIds.has\\(id\\);"
  if ($map -notmatch $loopAnchor) { Fail "Could not find loop anchor 'const isStuck = activeStuckIds.has(id);' in $MAP_PATH" }

  $map = [regex]::Replace($map, $loopAnchor, {
    param($m)
    return $m.Value + "`n      const statusNorm = String(raw.status ?? \"\").trim().toLowerCase();`n      const lastSeenIso = raw.driver_last_seen_at ?? raw.updated_at ?? raw.inserted_at ?? null;`n      const ageMin = minutesSinceIso(lastSeenIso);`n      const stale = ([\"assigned\",\"on_the_way\",\"on_trip\"].includes(statusNorm) && ageMin >= 3);`n      const ring = statusRingColor(statusNorm);"
  }, 1)
  Write-Host "[OK] Added statusNorm + stale + ring color inside marker loop."
}

# Replace the img styling section to include ring + stale glow
$map = $map -replace [regex]::Escape($markerNeedle), ($markerNeedle + "`n          // Visual confidence ring (status) + stale glow (UI-only)`n          const ringWrap = document.createElement(\"div\");`n          ringWrap.style.width = \"46px\";`n          ringWrap.style.height = \"46px\";`n          ringWrap.style.borderRadius = \"9999px\";`n          ringWrap.style.border = `\"3px solid ${ring}`\";`n          ringWrap.style.boxSizing = \"border-box\";`n          ringWrap.style.transform = \"translate(-50%, -50%)\";`n          ringWrap.style.display = \"flex\";`n          ringWrap.style.alignItems = \"center\";`n          ringWrap.style.justifyContent = \"center\";`n          if (stale) ringWrap.style.boxShadow = \"0 0 0 6px rgba(245,158,11,0.35)\";`n          ringWrap.appendChild(el);`n          // Replace marker element to ringWrap`n          marker = new mapboxgl.Marker(ringWrap).setLngLat(driverDisplay).addTo(map);`n          marker.getElement().classList.toggle(\"jride-marker-blink\", (isStuck || isProblem));`n          nextDrivers[id] = marker;`n          continue;")

# The above inserted a continue; so we must ensure we didn't leave duplicate assignment below.
# If it didn't apply (file differs), we fail safe by checking if 'ringWrap' exists.
if ($map -notmatch "ringWrap\.style\.border") {
  Fail "Map patch did not apply correctly (ringWrap not found)."
}

WriteUtf8NoBom $MAP_PATH $map

Write-Host ""
Write-Host "[DONE] PHASE 7A applied: LiveTrips visual confidence cues (list + map)."
