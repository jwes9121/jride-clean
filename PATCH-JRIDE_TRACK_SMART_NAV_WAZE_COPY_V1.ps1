# PATCH-JRIDE_TRACK_SMART_NAV_WAZE_COPY_V1.ps1
# Smart navigation button + Waze + Copy link (PS5-safe)
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red; throw $m }

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

$root = (Get-Location).Path
if (!(Test-Path (Join-Path $root "package.json"))) {
  Fail "Run this from your Next.js repo root (where package.json exists)."
}

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $root "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null

$trackClient = Join-Path $root "app\ride\track\TrackClient.tsx"
if (!(Test-Path $trackClient)) { Fail "Missing: $trackClient" }

# Backup
$bak = Join-Path $bakDir ("TrackClient.tsx.bak.{0}" -f $ts)
Copy-Item -Force $trackClient $bak
Ok "[OK] Backup: $bak"

$src = Get-Content -Raw -Path $trackClient

# Replace existing openGoogleRoute() function with a smarter nav/waze/copy block
$patternFunc = '(?s)function openGoogleRoute\(\)\s*\{\s*if\s*\(!pickup\s*\|\|\s*!dropoff\)\s*return;\s*const url = `https:\/\/www\.google\.com\/maps\/dir\/\?\S+?`;\s*window\.open\(url,\s*"_blank"\);\s*\}'
if ($src -notmatch $patternFunc) {
  Fail "Anchor not found: openGoogleRoute() block. TrackClient.tsx changed; upload that file and I'll patch to the new structure."
}

$replacementFunc = @'
function getPhase(): "to_pickup" | "to_dropoff" {
    const st = String(booking?.status || "").toLowerCase();
    // Before pickup / pre-start: guide driver to pickup (Grab/Angkas pattern)
    const toPickup = ["fare_proposed","accepted","ready","assigned","pending"].includes(st);
    if (toPickup) return "to_pickup";
    // After pickup started or moving: guide to dropoff
    return "to_dropoff";
  }

  function buildGoogleDirUrl(origin: {lat:number,lng:number}, dest: {lat:number,lng:number}) {
    return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${dest.lat},${dest.lng}&travelmode=driving`;
  }

  function buildWazeUrl(origin: {lat:number,lng:number}, dest: {lat:number,lng:number}) {
    // Waze deep link: destination only is most reliable; include origin in the share text/link via Google as fallback.
    // We'll navigate to destination in Waze; for "to_pickup" destination=pickup, for "to_dropoff" destination=dropoff.
    return `https://waze.com/ul?ll=${dest.lat}%2C${dest.lng}&navigate=yes`;
  }

  function computeSmartOriginDest(): { origin: {lat:number,lng:number}, dest: {lat:number,lng:number}, phase: "to_pickup" | "to_dropoff" } | null {
    if (!pickup || !dropoff) return null;

    const phase = getPhase();

    if (phase === "to_pickup") {
      // Prefer live driver location as origin; fallback to pickup if missing
      const origin = driver ? driver : pickup;
      const dest = pickup;
      return { origin, dest, phase };
    }

    // to_dropoff
    return { origin: pickup, dest: dropoff, phase };
  }

  async function copyRouteLink() {
    const x = computeSmartOriginDest();
    if (!x) return;
    const url = buildGoogleDirUrl(x.origin, x.dest);
    try {
      await navigator.clipboard.writeText(url);
      alert("Route link copied.");
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      alert("Route link copied.");
    }
  }

  function openSmartGoogleMaps() {
    const x = computeSmartOriginDest();
    if (!x) return;
    const url = buildGoogleDirUrl(x.origin, x.dest);
    window.open(url, "_blank");
  }

  function openSmartWaze() {
    const x = computeSmartOriginDest();
    if (!x) return;
    const url = buildWazeUrl(x.origin, x.dest);
    window.open(url, "_blank");
  }

  function smartNavLabel() {
    const st = String(booking?.status || "").toLowerCase();
    const phase = getPhase();
    const suffix =
      phase === "to_pickup"
        ? "Navigate to Pickup"
        : "Navigate to Dropoff";
    // Small hint for passenger view
    if (st === "ready") return suffix + " (driver)";
    return suffix;
  }
'@

$src2 = [regex]::Replace($src, $patternFunc, $replacementFunc, "Singleline")

# Replace the single Google Maps button with 3 buttons (Smart Navigate / Waze / Copy)
# Anchor: the existing button text "Open Route in Google Maps"
$patternBtn = '(?s)<button\s+className="mt-3 w-full rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"\s+onClick=\{openGoogleRoute\}\s+disabled=\{!pickup \|\| !dropoff\}\s*>[\s\S]*?Open Route in Google Maps[\s\S]*?</button>'
if ($src2 -notmatch $patternBtn) {
  Fail "Anchor not found: Open Route button block. TrackClient.tsx changed; upload that file and I'll patch to the new structure."
}

$replacementBtn = @'
<div className="mt-3 grid grid-cols-1 gap-2">
              <button
                className="w-full rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={openSmartGoogleMaps}
                disabled={!pickup || !dropoff}
                title="Smart route: driver → pickup (before pickup), pickup → dropoff (after start)"
              >
                {smartNavLabel()}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
                  onClick={openSmartWaze}
                  disabled={!pickup || !dropoff}
                >
                  Open in Waze
                </button>

                <button
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
                  onClick={copyRouteLink}
                  disabled={!pickup || !dropoff}
                >
                  Copy route link
                </button>
              </div>
            </div>
'@

$src3 = [regex]::Replace($src2, $patternBtn, $replacementBtn, "Singleline")

WriteUtf8NoBom $trackClient $src3
Ok "[OK] Patched: app/ride/track/TrackClient.tsx"
Ok "=== DONE: Smart Navigate + Waze + Copy link applied ==="
Ok "[NEXT] Refresh /ride/track?code=... and test: ready => driver→pickup, on_trip => pickup→dropoff"
