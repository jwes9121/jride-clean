param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function BackupFile([string]$absPath, [string]$tag, [string]$bakRoot) {
  if (!(Test-Path -LiteralPath $absPath)) { return $null }
  New-Item -ItemType Directory -Force -Path $bakRoot | Out-Null
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = Split-Path -Leaf $absPath
  $bak = Join-Path $bakRoot ($name + ".bak." + $tag + "." + $ts)
  Copy-Item -LiteralPath $absPath -Destination $bak -Force
  return $bak
}

Info "== JRIDE Patch: LiveTripsMap MARKER VISIBILITY TEST (V1 / PS5-safe) =="
Info "Repo: $ProjRoot"
Write-Host ""

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$mapPath = Join-Path $ProjRoot "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path -LiteralPath $mapPath)) { Fail "[FAIL] LiveTripsMap.tsx not found: $mapPath" }

$bakRoot = Join-Path $ProjRoot "_patch_bak"
$bak = BackupFile $mapPath "LIVETRIPSMAP_MARKER_VIS_TEST_V1" $bakRoot
if ($bak) { Ok "[OK] Backup: $bak" }

$txt = [System.IO.File]::ReadAllText($mapPath, [System.Text.Encoding]::UTF8)

# ------------------------------------------------------------
# 1) Ensure component destructures "drivers" from props
# ------------------------------------------------------------
$patComp = '(?ms)export\s+const\s+LiveTripsMap:\s*React\.FC<LiveTripsMapProps>\s*=\s*\(\{\s*([\s\S]*?)\s*\}\)\s*=>'
$mComp = [System.Text.RegularExpressions.Regex]::Match($txt, $patComp)
if (!$mComp.Success) { Fail "[FAIL] Could not locate LiveTripsMap props destructuring." }

$inside = $mComp.Groups[1].Value
if ($inside -notmatch '\bdrivers\b') {
  # Insert "drivers," after "trips," if possible; otherwise add at top.
  if ($inside -match '\btrips\s*,') {
    $inside2 = [System.Text.RegularExpressions.Regex]::Replace($inside, '\btrips\s*,', "trips,`r`n  drivers,")
  } else {
    $inside2 = "drivers,`r`n  " + $inside
  }
  $newComp = $mComp.Value -replace [regex]::Escape($inside), $inside2
  $txt = $txt.Substring(0, $mComp.Index) + $newComp + $txt.Substring($mComp.Index + $mComp.Length)
  Ok "[OK] Added drivers to LiveTripsMap props destructuring."
} else {
  Warn "[WARN] LiveTripsMap already destructures drivers."
}

# ------------------------------------------------------------
# 2) Replace fleetMarkerColor() to ALWAYS show (visibility test)
# ------------------------------------------------------------
$patFleetColor = '(?ms)function\s+fleetMarkerColor\s*\(\s*d\s*:\s*any\s*\)\s*:\s*\{\s*bg\s*:\s*string;\s*ring\s*:\s*string;\s*show\s*:\s*boolean\s*\}\s*\{[\s\S]*?\r?\n\}'
$mFC = [System.Text.RegularExpressions.Regex]::Match($txt, $patFleetColor)
if (!$mFC.Success) {
  Warn "[WARN] fleetMarkerColor() signature not matched exactly. Trying looser match…"
  $patFleetColor2 = '(?ms)function\s+fleetMarkerColor\s*\([\s\S]*?\)\s*\{[\s\S]*?\r?\n\}'
  $mFC = [System.Text.RegularExpressions.Regex]::Match($txt, $patFleetColor2)
}
if (!$mFC.Success) { Fail "[FAIL] Could not locate fleetMarkerColor() to patch." }

$fleetColorReplacement = @'
function fleetMarkerColor(d: any): { bg: string; ring: string; show: boolean } {
  // VISIBILITY TEST MODE: ALWAYS SHOW
  // stale => gray, online/available => green, offline => orange
  const s = String(d?.status ?? "").trim().toLowerCase();
  const stale = isStaleDriver(d);
  const isOnline = (s === "available" || s === "online" || s === "idle" || s.includes("waiting"));
  const isOffline = (!s || s === "offline" || s.includes("offline"));

  if (stale) return { bg: "#6b7280", ring: "#ffffff", show: true };
  if (isOffline) return { bg: "#f59e0b", ring: "#ffffff", show: true };
  if (isOnline) return { bg: "#22c55e", ring: "#ffffff", show: true };

  return { bg: "#3b82f6", ring: "#ffffff", show: true };
}
'@

$txt = $txt.Substring(0, $mFC.Index) + $fleetColorReplacement + $txt.Substring($mFC.Index + $mFC.Length)
Ok "[OK] Patched fleetMarkerColor() to ALWAYS show markers."

# ------------------------------------------------------------
# 3) Add a big TEST marker (80px) once mapReady is true
#    Insert a ref near mapRef, and a useEffect after mapReady is set up.
# ------------------------------------------------------------
if ($txt -notmatch 'testMarkerRef') {
  $anchorMapRef = '(?m)^\s*const\s+mapRef\s*=\s*useRef<mapboxgl\.Map\s*\|\s*null>\(null\);\s*$'
  $mMR = [System.Text.RegularExpressions.Regex]::Match($txt, $anchorMapRef)
  if (!$mMR.Success) { Fail "[FAIL] Could not find mapRef declaration to attach testMarkerRef." }

  $ins = "`r`n  const testMarkerRef = useRef<mapboxgl.Marker | null>(null);`r`n"
  $idx = $mMR.Index + $mMR.Length
  $txt = $txt.Substring(0, $idx) + $ins + $txt.Substring($idx)
  Ok "[OK] Inserted testMarkerRef."
} else {
  Warn "[WARN] testMarkerRef already present."
}

if ($txt -notmatch 'JRIDE_TEST_MARKER_V1') {
  $anchorMapReady = '(?m)^\s*const\s+\[mapReady\s*,\s*setMapReady\]\s*=\s*useState\(\s*false\s*\)\s*;\s*$'
  $mReady = [System.Text.RegularExpressions.Regex]::Match($txt, $anchorMapReady)
  if (!$mReady.Success) {
    Warn "[WARN] Could not find mapReady useState line to inject test marker effect. Trying to inject after setMapReady declaration exists…"
    $mReady = [System.Text.RegularExpressions.Regex]::Match($txt, '(?m)^\s*const\s+\[mapReady\s*,\s*setMapReady\]\s*=\s*useState\([\s\S]*?\);\s*$')
  }
  if (!$mReady.Success) { Fail "[FAIL] Could not find mapReady state declaration to inject test marker effect." }

  $testEffect = @'

  // ===== TEST MARKER (V1) =====
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    try {
      if (testMarkerRef.current) {
        testMarkerRef.current.remove();
        testMarkerRef.current = null;
      }
    } catch { }

    try {
      const el = document.createElement("div");
      el.style.width = "80px";
      el.style.height = "80px";
      el.style.borderRadius = "9999px";
      el.style.background = "#ff00ff";
      el.style.border = "4px solid #ffffff";
      el.style.boxShadow = "0 6px 18px rgba(0,0,0,0.45)";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.fontSize = "14px";
      el.style.fontWeight = "900";
      el.style.color = "#ffffff";
      el.style.zIndex = "999999";
      el.textContent = "TEST";

      const c = map.getCenter();
      testMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat([c.lng, c.lat])
        .addTo(map);

      // eslint-disable-next-line no-console
      console.log("[JRIDE_TEST_MARKER_V1] added at center", c.lng, c.lat);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log("[JRIDE_TEST_MARKER_V1] failed", e);
    }
  }, [mapReady]); // JRIDE_TEST_MARKER_V1

'@

  $idx2 = $mReady.Index + $mReady.Length
  $txt = $txt.Substring(0, $idx2) + $testEffect + $txt.Substring($idx2)
  Ok "[OK] Injected JRIDE_TEST_MARKER_V1 useEffect."
} else {
  Warn "[WARN] JRIDE_TEST_MARKER_V1 already present."
}

# ------------------------------------------------------------
# 4) Force fleet marker DOM size bigger (look for width/height 22px and bump)
# ------------------------------------------------------------
$txt2 = $txt
$txt2 = $txt2 -replace 'el\.style\.width\s*=\s*\"22px\";', 'el.style.width = "36px";'
$txt2 = $txt2 -replace 'el\.style\.height\s*=\s*\"22px\";', 'el.style.height = "36px";'
if ($txt2 -ne $txt) {
  $txt = $txt2
  Ok "[OK] Increased fleet marker size (22px -> 36px) where applicable."
} else {
  Warn "[WARN] Did not find 22px fleet marker size lines to replace (file may differ)."
}

WriteUtf8NoBom $mapPath $txt
Ok "[OK] Wrote LiveTripsMap.tsx (UTF-8 no BOM)."
Ok "[NEXT] Run: npm.cmd run build"