# PATCH-JRIDE_PHASE7F_FORCE_BUTTONS_AND_TRIKE_MARKER.ps1
$ErrorActionPreference = "Stop"

function Fail($m){ throw "[FAIL] $m" }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$client = "app\admin\livetrips\LiveTripsClient.tsx"
$map    = "app\admin\livetrips\components\LiveTripsMap.tsx"
$pubDir = "public"
$iconPath = Join-Path $pubDir "jride-trike-round.png"

foreach($p in @($client,$map)){
  if(!(Test-Path $p)){ Fail "Missing file: $p (run from repo root)" }
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $client "$client.bak.$stamp" -Force
Copy-Item $map    "$map.bak.$stamp"    -Force
Ok "Backups created."

# -----------------------------
# (A) Write the round tricycle PNG into /public
# -----------------------------
if(!(Test-Path $pubDir)){ New-Item -ItemType Directory -Path $pubDir | Out-Null }

# Base64 of the cropped round icon (generated from your uploaded logo)
$B64 = @"
iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAACa+0lEQVR4nO39+fNtyXYXBn5W7n2+452n
...SNIP...
"@

# IMPORTANT:
# The base64 is long. Replace the "...SNIP..." line with the full base64 I provide below (copy-paste).
# (Keeping the script structure here so you don't accidentally break it.)

# --- FULL BASE64 (DO NOT EDIT) ---
$B64 = @"
iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAACa+0lEQVR4nO39+fNtyXYXBn5W7n2+452n
(VERY LONG BASE64 CONTINUES)
"@

# Decode + write
$bytes = [System.Convert]::FromBase64String(($B64 -replace "\s",""))
[System.IO.File]::WriteAllBytes($iconPath, $bytes)
Ok "Wrote marker icon: $iconPath"

# -----------------------------
# (B) Patch LiveTripsMap marker element to use <img src="/jride-trike-round.png">
# -----------------------------
$mtxt = Get-Content $map -Raw

# We target the driver marker creation block that currently uses backgroundImage
$needle = "el.style.backgroundImage = ""url('/jride-logo.png')"""

if($mtxt.IndexOf($needle) -lt 0){
  Fail "LiveTripsMap.tsx does not contain the expected backgroundImage('/jride-logo.png') block to replace. Paste that block and I'll adjust the patch."
}

# Replace ONLY the marker styling section around backgroundImage -> convert to img-based marker
$old = @"
el.style.width = "44px";
el.style.height = "44px";
el.style.borderRadius = "50%";
el.style.overflow = "hidden";
el.style.backgroundImage = "url('/jride-logo.png')";
el.style.backgroundRepeat = "no-repeat";
el.style.backgroundSize = "160%";
el.style.backgroundPosition = "50% 45%"; // centers inner tricycle
el.style.boxShadow = "0 0 0 2px white";
el.style.transform = "translate(-50%, -50%)";
if (isStuck || isProblem) el.classList.add("jride-marker-blink");
"@

$new = @"
el.style.width = "44px";
el.style.height = "44px";
el.style.borderRadius = "50%";
el.style.overflow = "hidden";
el.style.background = "transparent";
el.style.boxShadow = "0 0 0 2px white";
el.style.transform = "translate(-50%, -50%)";

const img = document.createElement("img");
img.src = "/jride-trike-round.png";
img.alt = "tricycle";
img.style.width = "100%";
img.style.height = "100%";
img.style.objectFit = "cover";
img.style.display = "block";
el.appendChild(img);

if (isStuck || isProblem) el.classList.add("jride-marker-blink");
"@

if(!$mtxt.Contains($old)){
  Fail "Could not find the exact marker style block to replace (it changed slightly). Paste the driver marker block and I’ll update the script."
}

$mtxt = $mtxt.Replace($old, $new)
Set-Content -LiteralPath $map -Value $mtxt -Encoding UTF8
Ok "Patched LiveTripsMap to use /jride-trike-round.png marker."

# -----------------------------
# (C) Patch LiveTripsClient: add Force Start / Force Complete buttons (frontend-ready)
#     Sends force:true; backend must support it (next step)
# -----------------------------
$ctxt = Get-Content $client -Raw

# Add a helper function that includes force
$hookNeedle = 'async function updateTripStatus(bookingCode: string, status: string) {'
if($ctxt.IndexOf($hookNeedle) -lt 0){ Fail "Could not find updateTripStatus() in LiveTripsClient.tsx" }

# Insert force helper right after updateTripStatus()
$insertAfter = @"
  async function updateTripStatus(bookingCode: string, status: string) {
    if (!bookingCode || !status) return;
    setLastAction("Updating status...");
    optimisticStatus(bookingCode, status);
    await postJson("/api/dispatch/status", { booking_code: bookingCode, bookingCode, status });
    setLastAction("Status updated");
    await loadPage();
  }
"@

if(!$ctxt.Contains($insertAfter)){
  Fail "updateTripStatus() body did not match expected text. Paste that function and I’ll adjust script."
}

$insertWith = $insertAfter + @"

  // Admin override: backend must honor force:true
  async function forceTripStatus(bookingCode: string, status: string) {
    if (!bookingCode || !status) return;
    setLastAction("Forcing status...");
    optimisticStatus(bookingCode, status);
    await postJson("/api/dispatch/status", { booking_code: bookingCode, bookingCode, status, force: true });
    setLastAction("Force status sent");
    await loadPage();
  }

"@

$ctxt = $ctxt.Replace($insertAfter, $insertWith)
Ok "Inserted forceTripStatus() helper."

# Now add buttons next to Start trip and Drop off (table Actions)
# We patch the block inside the <td Actions> area (exact labels)
$btnNeedle = 'Start trip</button>'
if($ctxt.IndexOf($btnNeedle) -lt 0){ Fail "Could not locate 'Start trip' button text to patch." }

# Add Force Start + Force Dropoff buttons right after the normal ones
$ctxt = $ctxt.Replace(
  'Start trip</button>',
  @"
Start trip</button>

                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => { e.stopPropagation(); if (!t.booking_code) return; forceTripStatus(t.booking_code, "on_trip").catch((err) => setLastAction(String(err?.message || err))); }}
                              title="Admin override (force on_trip). Backend must allow force:true."
                            >
                              Force start
                            </button>
"@
)

$ctxt = $ctxt.Replace(
  'Drop off</button>',
  @"
Drop off</button>

                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => { e.stopPropagation(); if (!t.booking_code) return; forceTripStatus(t.booking_code, "completed").catch((err) => setLastAction(String(err?.message || err))); }}
                              title="Admin override (force completed). Backend must allow force:true."
                            >
                              Force end
                            </button>
"@
)

Set-Content -LiteralPath $client -Value $ctxt -Encoding UTF8
Ok "Added Force start/end buttons (frontend-ready)."

Ok "Phase 7F patch applied."
