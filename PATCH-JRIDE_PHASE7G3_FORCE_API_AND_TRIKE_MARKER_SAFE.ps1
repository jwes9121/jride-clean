# PATCH-JRIDE_PHASE7G3_FORCE_API_AND_TRIKE_MARKER_SAFE.ps1
# - LiveTripsMap: replace driver marker element creation with round trike icon (/icons/jride-trike.png)
# - Dispatch status API: allow force:true to bypass transition gate (variant-safe)
# NO REGEX

$ErrorActionPreference = "Stop"
function Fail($m){ throw "[FAIL] $m" }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$map = "app\admin\livetrips\components\LiveTripsMap.tsx"
$api = "app\api\dispatch\status\route.ts"
$icon = "public\icons\jride-trike.png"

foreach($p in @($map,$api,$icon)){
  if(!(Test-Path $p)){ Fail "Missing: $p (run from repo root)" }
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $map "$map.bak.$stamp" -Force
Copy-Item $api "$api.bak.$stamp" -Force
Ok "Backups created (*.bak.$stamp)."

# -------------------------
# (1) LiveTripsMap.tsx marker patch (structure-based)
# -------------------------
$mtxt = Get-Content $map -Raw

$anchor = "// DRIVER marker"
$a = $mtxt.IndexOf($anchor)
if($a -lt 0){ Fail "LiveTripsMap: could not find anchor '$anchor'." }

# Find the first 'if (!marker) {' after the anchor
$ifMarker = "if (!marker) {"
$i1 = $mtxt.IndexOf($ifMarker, $a)
if($i1 -lt 0){ Fail "LiveTripsMap: could not find '$ifMarker' after DRIVER marker anchor." }

# Find the element creation start after if(!marker)
$createNeedle = 'const el = document.createElement'
$c1 = $mtxt.IndexOf($createNeedle, $i1)
if($c1 -lt 0){ Fail "LiveTripsMap: could not find 'const el = document.createElement' inside driver marker creation." }

# Find marker creation line that uses 'el'
$mkNeedle = "marker = new mapboxgl.Marker(el)"
$m1 = $mtxt.IndexOf($mkNeedle, $c1)
if($m1 -lt 0){ Fail "LiveTripsMap: could not find 'marker = new mapboxgl.Marker(el)' after element creation." }

# Replace everything from const el... up to just before marker = new mapboxgl.Marker(el)...
$newBlock = @"
const el = document.createElement("div");
el.style.width = "44px";
el.style.height = "44px";
el.style.borderRadius = "50%";
el.style.overflow = "hidden";
el.style.background = "white";
el.style.boxShadow = "0 0 0 2px rgba(255,255,255,0.95)";
el.style.transform = "translate(-50%, -50%)";

// Tricycle icon (crop/zoom to show inner trike)
const img = document.createElement("img");
img.src = "/icons/jride-trike.png";
img.alt = "tricycle";
img.style.width = "100%";
img.style.height = "100%";
img.style.display = "block";
img.style.objectFit = "cover";
img.style.objectPosition = "50% 45%";
img.style.transform = "scale(1.35)";
img.style.transformOrigin = "50% 50%";
el.appendChild(img);

if (isStuck || isProblem) el.classList.add("jride-marker-blink");
"@

$before = $mtxt.Substring(0, $c1)
$after  = $mtxt.Substring($m1)   # starts at marker = new mapboxgl.Marker(el)
$mtxt2 = $before + $newBlock + $after

Set-Content -LiteralPath $map -Value $mtxt2 -Encoding UTF8
Ok "LiveTripsMap: marker now uses /icons/jride-trike.png (round + cropped)."

# -------------------------
# (2) Dispatch status API: force:true bypass transition gate (variant-safe)
# -------------------------
$atxt = Get-Content $api -Raw
$changed = $false

# Ensure force is read
if($atxt.IndexOf("const force") -lt 0){
  $bodyNeedle = 'const body = (await req.json().catch(() => ({}))) as StatusReq;'
  $b = $atxt.IndexOf($bodyNeedle)
  if($b -lt 0){ Fail "API: could not find body parse line to attach force flag." }

  $atxt = $atxt.Replace($bodyNeedle, $bodyNeedle + "`r`n`r`n  const force = Boolean((body as any).force);")
  $changed = $true
  Ok "API: added const force = Boolean(body.force)."
}

# Patch the first transition gate line that contains allowedNext.includes( and starts with if (
$lines = $atxt -split "`r?`n"
$patchedGate = $false

for($i=0; $i -lt $lines.Length; $i++){
  $t = $lines[$i].Trim()
  if($t.StartsWith("if (") -and $t.Contains("allowedNext") -and $t.Contains(".includes(") -and $t.Contains("!allowedNext.includes(")){
    if($t.IndexOf("!force") -lt 0){
      $lines[$i] = $lines[$i].Replace("if (", "if (!force && ")
      $patchedGate = $true
      $changed = $true
      Ok "API: patched transition gate to respect force:true."
    }
    break
  }
}

# If not found, fallback: search any line containing "allowedNext.includes(" and "if (" and "!"
if(-not $patchedGate){
  for($i=0; $i -lt $lines.Length; $i++){
    $t = $lines[$i].Trim()
    if($t.StartsWith("if (") -and $t.Contains("allowedNext.includes(") -and $t.Contains("!")){
      if($t.IndexOf("!force") -lt 0){
        $lines[$i] = $lines[$i].Replace("if (", "if (!force && ")
        $patchedGate = $true
        $changed = $true
        Ok "API: patched transition gate (fallback match)."
      }
      break
    }
  }
}

if(-not $patchedGate){
  Fail "API: could not locate transition gate line containing allowedNext.includes(...). Paste the relevant section around 'allowedNext' and 'Cannot transition'."
}

$atxt2 = ($lines -join "`r`n")
Set-Content -LiteralPath $api -Value $atxt2 -Encoding UTF8
Ok "API: wrote changes."

Ok "Phase 7G3 patch complete."
