# PATCH-NEXT_LIVETRIPS_FINISHING-UI.ps1
# Finishing-only UI patch:
# - Remove broken setTripStatus block in LiveTripsClient
# - Make page-data parser handle numeric-key objects ("0","1",... + zones)
# - TripLifecycleActions refreshes immediately (onAfterAction -> loadPage)
# - Manual driver dropdown shows FULL UUID + name
# - Audio 404 fix: only render <audio> if file exists (HEAD check)
# Does NOT change Mapbox layout/styling.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path

$clientPath = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $clientPath)) { Fail "Missing: $clientPath" }

# map file can be in components or map folder
$mapCandidates = @(
  (Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"),
  (Join-Path $root "app\admin\livetrips\map\LiveTripsMap.tsx")
)
$mapPath = $mapCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (!$mapPath) { Fail "Could not find LiveTripsMap.tsx in components/ or map/." }

Write-Host "[1/2] Patch LiveTripsClient: $clientPath" -ForegroundColor Cyan
$txt = Get-Content -Raw -Encoding UTF8 $clientPath
$orig = $txt

# (A) Remove the broken setTripStatus block (it contains invalid placeholder text)
# Remove from the comment line to just before: const [allTrips...
$txt = [regex]::Replace(
  $txt,
  '(?s)\r?\n\s*//\s*---\s*ACTIONS:.*?\r?\n\s*const\s+setTripStatus\s*=\s*async\s*\(.*?\)\s*=>\s*\{.*?\r?\n\s*\};\s*',
  "`r`n",
  1
)

# (B) Replace parseTripsFromPageData() with a numeric-key aware version
$parsePattern = '(?s)function\s+parseTripsFromPageData\s*\(j:\s*any\)\s*:\s*TripRow\[\]\s*\{.*?\r?\n\}'
if ($txt -notmatch $parsePattern) { Fail "Could not find parseTripsFromPageData() to patch." }

$parseReplacement = @'
function parseTripsFromPageData(j: any): TripRow[] {
  if (!j) return [];

  // Case 1: common wrapper arrays
  const candidates = [j.trips, j.bookings, j.data];
  for (const c of candidates) {
    const arr = safeArray<TripRow>(c);
    if (arr.length) return arr;
  }

  // Case 2: raw array
  if (Array.isArray(j)) return j as TripRow[];

  // Case 3: numeric-key object: { "0": {...}, "1": {...}, ..., zones: {...} }
  try {
    const keys = Object.keys(j).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
    if (keys.length) {
      const out: TripRow[] = [];
      for (const k of keys) out.push(j[k]);
      return out;
    }
  } catch {}

  return [];
}
'@

$txt = [regex]::Replace($txt, $parsePattern, $parseReplacement, 1)

# (C) TripLifecycleActions should refresh immediately
$txt = $txt.Replace(
  '<TripLifecycleActions trip={selectedTrip as any} />',
  '<TripLifecycleActions trip={selectedTrip as any} onAfterAction={() => { loadPage().catch(() => {}); }} />'
)

# (D) Manual driver dropdown label => FULL UUID + name
# Replace the current simple label builder block inside drivers.map(...)
$dropdownPattern = '(?s)\{drivers\.map\(\(d,\s*idx\)\s*=>\s*\{\s*const id = String\(d\.driver_id \|\| ""\);\s*const label = `\$\{d\.name \|\| "Driver"\}\s*\$\{d\.town \? `— \$\{d\.town\}` : ""\}\s*\$\{d\.status \? `— \$\{d\.status\}` : ""\}`\.trim\(\);\s*return\s*\(\s*<option key=\{id \|\| idx\} value=\{id\}>\s*\{label\}\s*</option>\s*\);\s*\}\)\}'
$dropdownReplacement = @'
{drivers.map((d, idx) => {
                    const id = String(d.driver_id || (d as any).id || (d as any).uuid || "");
                    const full = id ? String(id) : "";
                    const short = full ? full.slice(0, 8) : String(idx + 1);
                    const displayName = d.name ? String(d.name) : `Driver ${short}`;
                    const label = `${displayName} — ${full || short}${d.town ? ` — ${d.town}` : ""}${d.status ? ` — ${d.status}` : ""}`.trim();
                    return (
                      <option key={full || idx} value={full}>
                        {label}
                      </option>
                    );
                  })}
'@

if ($txt -match $dropdownPattern) {
  $txt = [regex]::Replace($txt, $dropdownPattern, $dropdownReplacement, 1)
} else {
  Write-Host "NOTE: dropdown pattern not matched (file may already be different). No dropdown change applied." -ForegroundColor Yellow
}

if ($txt -eq $orig) {
  Write-Host "NOTE: LiveTripsClient ended up unchanged (patterns not found or already patched)." -ForegroundColor Yellow
} else {
  Set-Content -Path $clientPath -Value $txt -Encoding UTF8
  Write-Host "OK: LiveTripsClient patched." -ForegroundColor Green
}


Write-Host "[2/2] Patch LiveTripsMap audio 404: $mapPath" -ForegroundColor Cyan
$map = Get-Content -Raw -Encoding UTF8 $mapPath
$mapOrig = $map

# Insert audioSrc guard after alertedIdsRef if not present
if ($map -notmatch 'const\s+\[audioSrc,\s*setAudioSrc\]') {
  $map = [regex]::Replace(
    $map,
    '(const alertedIdsRef\s*=\s*useRef<Set<string>>\(new Set\(\)\);\s*)',
@'
$1

  // Audio source guard (prevents console 404 spam if file is missing)
  const [audioSrc, setAudioSrc] = useState<string>("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/audio/jride_audio.mp3", { method: "HEAD" });
        if (!alive) return;
        setAudioSrc(r.ok ? "/audio/jride_audio.mp3" : "");
      } catch {
        if (!alive) return;
        setAudioSrc("");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
'@,
    1
  )
}

# Replace the hidden audio element with conditional render
$map = [regex]::Replace(
  $map,
  '(?s)\{/\*\s*Hidden audio element\s*\*/\}\s*<audio\s*[\s\S]*?ref=\{alertAudioRef\}[\s\S]*?src="\/audio\/jride_audio\.mp3"[\s\S]*?preload="auto"[\s\S]*?\/>\s*',
@'
        {/* Hidden audio element (guarded) */}
        {audioSrc ? (
          <audio ref={alertAudioRef} src={audioSrc} preload="auto" />
        ) : null}

'@,
  1
)

if ($map -eq $mapOrig) {
  Write-Host "NOTE: LiveTripsMap unchanged (audio may already be guarded or pattern differs)." -ForegroundColor Yellow
} else {
  Set-Content -Path $mapPath -Value $map -Encoding UTF8
  Write-Host "OK: LiveTripsMap audio guarded." -ForegroundColor Green
}

Write-Host ""
Write-Host "DONE. Run:" -ForegroundColor Cyan
Write-Host "  npm run dev" -ForegroundColor White
Write-Host "Then check:" -ForegroundColor Cyan
Write-Host "  1) /admin/livetrips loads (no weird placeholder text errors)" -ForegroundColor White
Write-Host "  2) Trips show even when page-data returns numeric keys" -ForegroundColor White
Write-Host "  3) TripLifecycleActions updates status and UI refreshes immediately" -ForegroundColor White
Write-Host "  4) Manual driver dropdown shows FULL UUID" -ForegroundColor White
Write-Host "  5) Console has no /audio/jride_audio.mp3 404" -ForegroundColor White
