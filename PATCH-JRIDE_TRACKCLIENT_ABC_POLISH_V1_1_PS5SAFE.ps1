# PATCH-JRIDE_TRACKCLIENT_ABC_POLISH_V1_1_PS5SAFE.ps1
# JRide Passenger Tracking - TrackClient.tsx polish (ABC)
# A) Replace driver marker with JRider logo "pop" marker (white circle + shadow)
# B) Reduce static map padding for tighter zoom
# C) Refresh UX: cooldown + last refreshed label + disable spam
# PS5-safe, backups, UTF-8 no BOM.

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = (Get-Location).Path

$tsRel = "app\ride\track\TrackClient.tsx"
$ts    = Join-Path $root $tsRel

$pngBaseRel = "public\markers\jrider-trike.png"
$pngBase    = Join-Path $root $pngBaseRel

$pngOutRel  = "public\markers\jrider-trike-64-pop.png"
$pngOut     = Join-Path $root $pngOutRel

Info "== JRide Patch: TrackClient ABC polish (V1.1 / PS5-safe) =="

if (!(Test-Path $ts))      { throw "Missing file: $tsRel (run from repo root)" }
if (!(Test-Path $pngBase)) { throw "Missing marker base PNG: $pngBaseRel" }

# Backup folder
$bakDir = Join-Path $root "_patch_bak"
if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"

# Backups
$tsBak = Join-Path $bakDir ("TrackClient.tsx.bak." + $stamp)
Copy-Item -LiteralPath $ts -Destination $tsBak -Force
Ok "[OK] Backup TS: $tsBak"

$pngBak = Join-Path $bakDir ("jrider-trike.png.bak." + $stamp)
Copy-Item -LiteralPath $pngBase -Destination $pngBak -Force
Ok "[OK] Backup marker base: $pngBak"

# ---------- A) Create POP marker PNG (64x64) ----------
Add-Type -AssemblyName System.Drawing

$size = 64
$pad  = 10  # inner padding for logo inside the circle

$src = [System.Drawing.Image]::FromFile($pngBase)
try {
  $dst = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $g = [System.Drawing.Graphics]::FromImage($dst)
    try {
      $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.Clear([System.Drawing.Color]::Transparent)

      # Shadow (subtle)
      $shadowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(60,0,0,0))
      $g.FillEllipse($shadowBrush, 4, 5, $size-8, $size-8)
      $shadowBrush.Dispose()

      # White circle background
      $whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(245,255,255,255))
      $g.FillEllipse($whiteBrush, 2, 2, $size-6, $size-6)
      $whiteBrush.Dispose()

      # Thin border
      $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(35,0,0,0)), 1
      $g.DrawEllipse($borderPen, 2, 2, $size-6, $size-6)
      $borderPen.Dispose()

      # Draw the logo centered inside circle (preserve aspect)
      $inner = $size - ($pad * 2)
      $scale = [Math]::Min($inner / $src.Width, $inner / $src.Height)
      $w = [int][Math]::Round($src.Width * $scale)
      $h = [int][Math]::Round($src.Height * $scale)
      if ($w -lt 1) { $w = 1 }
      if ($h -lt 1) { $h = 1 }
      $x = [int][Math]::Floor(($size - $w) / 2)
      $y = [int][Math]::Floor(($size - $h) / 2)

      $g.DrawImage($src, $x, $y, $w, $h)
    } finally {
      $g.Dispose()
    }

    $dst.Save($pngOut, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $dst.Dispose()
  }
} finally {
  $src.Dispose()
}

Ok "[OK] Wrote POP marker: $pngOutRel (64x64)"

# ---------- Patch TrackClient.tsx ----------
$txt  = Get-Content -Raw -LiteralPath $ts
$orig = $txt

# B) tighter padding: padding=80 -> padding=50 (safe global replace)
$txt = [regex]::Replace($txt, '(?i)padding=80', 'padding=50')

# A) Insert JRider icon helper block right after "const pins: string[] = [];"
if ($txt -notmatch 'JRIDE_JRIDER_ICON_BEGIN') {
  $needle = '(?m)^\s*const\s+pins:\s*string\[\]\s*=\s*\[\];\s*$'
  if ($txt -match $needle) {
    $helper = @"
const pins: string[] = [];

// JRIDE_JRIDER_ICON_BEGIN
// Mapbox Static "url-" markers must be publicly reachable.
// For local dev, force production host so Mapbox can fetch the icon.
const iconHost =
  (process.env.NEXT_PUBLIC_APP_ORIGIN ||
    (typeof window !== "undefined" ? window.location.origin : "")) as string;
const publicHost =
  iconHost && !iconHost.includes("localhost") ? iconHost : "https://app.jride.net";
const jriderIconUrl = publicHost + "/markers/jrider-trike-64-pop.png";
const jriderIconEnc = encodeURIComponent(jriderIconUrl);
// JRIDE_JRIDER_ICON_END
"@
    $txt = [regex]::Replace($txt, $needle, $helper, 1)
    Ok "[OK] Inserted JRIDE_JRIDER_ICON block."
  } else {
    throw "Could not find 'const pins: string[] = [];' to insert JRider icon helper."
  }
} else {
  Info "[INFO] JRIDE_JRIDER_ICON block already present (skipping)."
}

# Replace driver marker pin with url-<icon>(lng,lat)
# Handles both old single-line pin and your earlier block fallback.
$before = $txt

# Replace a simple single-line push like pin-l-car...
$txt = [regex]::Replace(
  $txt,
  '(?m)^\s*if\s*\(\s*driver\s*\)\s*pins\.push\(\s*`pin-[^`]*\(\$\{driver\.lng\},\$\{driver\.lat\}\)`\s*\)\s*;\s*$',
  '  if (driver) pins.push(`url-${jriderIconEnc}(${driver.lng},${driver.lat})`);'
)

# If not changed, try replacing within a block that contains pin-l-car fallback
if ($txt -eq $before) {
  $txt = [regex]::Replace(
    $txt,
    'pins\.push\(\s*`pin-[^`]*\(\$\{driver\.lng\},\$\{driver\.lat\}\)`\s*\)\s*;',
    'pins.push(`url-${jriderIconEnc}(${driver.lng},${driver.lat})`);'
  )
}

Ok "[OK] Set driver marker to JRider POP icon (url- overlay)."

# Ensure legend text
$txt = [regex]::Replace($txt, '(?i)Markers:\s*A=pickup,\s*B=dropoff,\s*car=driver', 'Markers: A=pickup, B=dropoff, JRider=driver')

# C) Refresh UX additions
# 1) Add lastRef + cooldown state after "const [last, setLast] = useState<string>(\"\");"
if ($txt -notmatch '\[lastRef,\s*setLastRef\]') {
  $stateNeedle = '(?m)^\s*const\s*\[\s*last\s*,\s*setLast\s*\]\s*=\s*useState<\s*string\s*>\(\s*""\s*\)\s*;\s*$'
  if ($txt -match $stateNeedle) {
    $stateInsert = @"
const [last, setLast] = useState<string>("");
const [lastRef, setLastRef] = useState<string>("");
const [cooldown, setCooldown] = useState(false);
"@
    $txt = [regex]::Replace($txt, $stateNeedle, $stateInsert, 1)
    Ok "[OK] Added refresh states (lastRef, cooldown)."
  } else {
    throw 'Could not find `const [last, setLast] = useState<string>("");` to insert refresh states.'
  }
} else {
  Info "[INFO] Refresh states already present (skipping)."
}

# 2) Add cooldown guard at top of refresh() function
if ($txt -notmatch 'JRIDE_REFRESH_COOLDOWN_BEGIN') {
  $refreshNeedle = '(?m)^\s*async\s+function\s+refresh\(\)\s*\{\s*$'
  if ($txt -match $refreshNeedle) {
    $guard = @"
async function refresh() {
    // JRIDE_REFRESH_COOLDOWN_BEGIN
    // Prevent spam-tapping refresh (mobile)
    if (cooldown) return;
    setCooldown(true);
    setTimeout(() => setCooldown(false), 1200);
    // JRIDE_REFRESH_COOLDOWN_END
"@
    $txt = [regex]::Replace($txt, $refreshNeedle, $guard, 1)
    Ok "[OK] Added refresh cooldown guard."
  } else {
    throw "Could not find refresh() function to add cooldown."
  }
} else {
  Info "[INFO] Refresh cooldown already present (skipping)."
}

# 3) After setLast(...), add setLastRef(...)
if ($txt -notmatch 'setLastRef\(') {
  $txt = [regex]::Replace(
    $txt,
    'setLast\(new Date\(\)\.toLocaleTimeString\(\)\);\s*',
    "setLast(new Date().toLocaleTimeString());`r`n      setLastRef(new Date().toLocaleTimeString());`r`n",
    1
  )
  Ok "[OK] Added setLastRef on refresh success."
}

# 4) Disable Refresh button when cooldown
$txt = [regex]::Replace($txt, 'disabled=\{\!code\s*\|\|\s*loading\}', 'disabled={!code || loading || cooldown}')

# 5) Update Refresh label to show Wait...
$txt = [regex]::Replace(
  $txt,
  '\{loading\s*\?\s*"Refreshing\.\.\."\s*:\s*"Refresh"\}',
  '{loading ? "Refreshing..." : (cooldown ? "Wait..." : "Refresh")}'
)

# 6) Add "Refreshed: ..." text under Refresh button (first </button> in header block)
if ($txt -notmatch 'Refreshed:\s*\{lastRef') {
  $txt = [regex]::Replace(
    $txt,
    '(</button>\s*)',
    '$1' + "`r`n" + '          <div className="mt-1 text-right text-[11px] opacity-60">Refreshed: {lastRef || "-"}</div>' + "`r`n",
    1
  )
  Ok "[OK] Added refreshed timestamp label."
}

if ($txt -eq $orig) {
  throw "No changes applied (unexpected)."
}

# Save UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($ts, $txt, $utf8NoBom)

Ok "[OK] Patched: $tsRel"
Info "NEXT: build + deploy so Mapbox can fetch https://app.jride.net/markers/jrider-trike-64-pop.png"
