param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

Write-Host "== PATCH JRIDE: LiveTripsMap driver marker label (jersey# else UUID prefix) V1.2 / PS5-safe =="

$target = Join-Path $ProjRoot "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path -LiteralPath $target)) {
  $alt = Join-Path $ProjRoot "app\admin\livetrips\LiveTripsMap.tsx"
  if (Test-Path -LiteralPath $alt) { $target = $alt }
  else { throw "LiveTripsMap.tsx not found at expected paths." }
}

$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir ("LiveTripsMap.tsx.bak.DRIVER_LABEL_BADGE_V1_2." + $ts)
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$content = Get-Content -LiteralPath $target -Raw -Encoding UTF8

# ---- 1) Insert helper function (robust anchor) ----
if ($content -notmatch "function getDriverLabelText\(") {

  $helper = @'
function getDriverLabelText(trip: any): string {
  // Prefer jersey number if present (supports multiple possible field names)
  const jersey =
    trip.jersey ??
    trip.jersey_no ??
    trip.jersey_number ??
    trip.driver_jersey ??
    trip.driver_jersey_no ??
    trip.driver_jersey_number ??
    trip.driverJersey ??
    trip.driverJerseyNo ??
    null;

  const jerseyStr = jersey != null ? String(jersey).trim() : "";
  if (jerseyStr) return jerseyStr;

  const id =
    trip.driver_id ??
    trip.driverId ??
    trip.driver_uuid ??
    trip.driverUuid ??
    null;

  const idStr = id != null ? String(id).trim() : "";
  if (idStr.length >= 2) return idStr.slice(0, 2).toUpperCase();
  if (idStr.length === 1) return idStr.toUpperCase();

  return "";
}

'@

  # Best anchor: insert right before "export default function LiveTripsMap"
  $re1 = [regex]::new("(?m)^\s*export\s+default\s+function\s+LiveTripsMap", [System.Text.RegularExpressions.RegexOptions]::Multiline)
  $m1 = $re1.Match($content)
  if ($m1.Success) {
    $content = $content.Insert($m1.Index, $helper)
    Write-Host "[OK] Inserted getDriverLabelText() before LiveTripsMap component."
  } else {
    # Fallback anchor: insert before "useEffect(() => {" of marker block (still safe)
    $re2 = [regex]::new("(?m)^\s*useEffect\(\(\)\s*=>\s*\{", [System.Text.RegularExpressions.RegexOptions]::Multiline)
    $m2 = $re2.Match($content)
    if ($m2.Success) {
      $content = $content.Insert($m2.Index, $helper)
      Write-Host "[OK] Inserted getDriverLabelText() before first useEffect()."
    } else {
      throw "Could not find insertion anchor for helper (no LiveTripsMap export default, no useEffect)."
    }
  }
} else {
  Write-Host "[WARN] getDriverLabelText() already exists. Skipping helper insert."
}

# ---- 2) Patch DRIVER marker creation block (exact) ----
$needle = @'
          const el = document.createElement("img");
          el.src = "/icons/jride-trike.png";
          el.style.width = "42px";
          el.style.height = "42px";
          el.style.transform = "translate(-50%, -50%)";
          if (isStuck || isProblem) el.classList.add("jride-marker-blink");
          marker = new mapboxgl.Marker(el).setLngLat(driverDisplay).addTo(map);
'@

$replacement = @'
          const wrap = document.createElement("div");
          wrap.style.position = "relative";
          wrap.style.width = "42px";
          wrap.style.height = "42px";
          wrap.style.transform = "translate(-50%, -50%)";

          const img = document.createElement("img");
          img.src = "/icons/jride-trike.png";
          img.style.width = "42px";
          img.style.height = "42px";
          img.style.display = "block";

          const badge = document.createElement("div");
          badge.setAttribute("data-jride-driver-label", "1");
          badge.style.position = "absolute";
          badge.style.left = "50%";
          badge.style.top = "-8px";
          badge.style.transform = "translateX(-50%)";
          badge.style.padding = "1px 6px";
          badge.style.borderRadius = "9999px";
          badge.style.fontSize = "10px";
          badge.style.fontWeight = "700";
          badge.style.lineHeight = "12px";
          badge.style.background = "rgba(0,0,0,0.75)";
          badge.style.color = "#fff";
          badge.style.border = "1px solid rgba(255,255,255,0.55)";
          badge.style.whiteSpace = "nowrap";
          badge.style.pointerEvents = "none";

          const labelText = getDriverLabelText(raw);
          badge.textContent = labelText;

          wrap.appendChild(img);
          if (labelText) wrap.appendChild(badge);

          if (isStuck || isProblem) wrap.classList.add("jride-marker-blink");

          marker = new mapboxgl.Marker(wrap).setLngLat(driverDisplay).addTo(map);
'@

if ($content -notmatch [regex]::Escape($needle)) {
  throw "Could not locate exact DRIVER marker img creation block to patch. File shape differs."
}
$content = $content.Replace($needle, $replacement)
Write-Host "[OK] Patched driver marker creation to wrapper+badge."

# ---- 3) Add badge refresh on marker updates (optional but good) ----
$updateAnchor = @'
          const el = marker.getElement();
          if (isStuck || isProblem) {
            el.classList.add("jride-marker-blink");
          } else {
            el.classList.remove("jride-marker-blink");
          }
'@

if ($content -match [regex]::Escape($updateAnchor)) {
  $updateReplace = @'
          const el = marker.getElement();
          // Update label text live (jersey/uuid can appear later)
          try {
            const badge = (el as any).querySelector("[data-jride-driver-label]");
            const labelText = getDriverLabelText(raw);
            if (badge) {
              badge.textContent = labelText;
              (badge as any).style.display = labelText ? "block" : "none";
            }
          } catch {}

          if (isStuck || isProblem) {
            el.classList.add("jride-marker-blink");
          } else {
            el.classList.remove("jride-marker-blink");
          }
'@
  $content = $content.Replace($updateAnchor, $updateReplace)
  Write-Host "[OK] Added live badge refresh on marker updates."
} else {
  Write-Host "[WARN] Marker update anchor not found; skipping badge refresh insertion."
}

Set-Content -LiteralPath $target -Value $content -Encoding UTF8
Write-Host "[OK] Wrote: $target"
Write-Host ""
Write-Host "NEXT: npm run build, then verify admin LiveTrips markers show jersey/UUID prefix."