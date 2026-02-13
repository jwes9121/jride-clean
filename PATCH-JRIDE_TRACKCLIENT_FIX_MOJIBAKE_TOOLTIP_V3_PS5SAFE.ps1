# PATCH-JRIDE_TRACKCLIENT_FIX_MOJIBAKE_TOOLTIP_V3_PS5SAFE.ps1
# Fix: Mojibake tooltip text on hover caused by URL/encoded strings being used in tooltip-ish attrs.
# Action: Replace URL-ish tooltip sources (title=, aria-label=, data-tooltip=, data-tip=) with safe text.
# PS5-safe, with backup, and prints match counts.

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$projRoot = (Get-Location).Path
$targetRel = "app\ride\track\TrackClient.tsx"
$target = Join-Path $projRoot $targetRel

Info "== JRide Patch: Fix mojibake tooltip attrs (V3 / PS5-safe) =="
Info ("Target: " + $target)

if (!(Test-Path $target)) {
  throw "Target file not found: $targetRel (run this from repo root)"
}

# Backup
$bakDir = Join-Path $projRoot "_patch_bak"
if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("TrackClient.tsx.bak." + $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "[OK] Backup: $bak"

$txt = Get-Content -Raw -LiteralPath $target
$orig = $txt

# Patterns: URL-ish values in tooltip attributes
# - JSX: title={...} / aria-label={...} / data-tooltip={...}
# - HTML: title="..." / aria-label="..." / data-tooltip="..."
# We treat as URL-ish if it contains: http, google maps, waze, mapbox, access_token, encodeURI, buildStaticMapUrl, route/nav
$attrs = "(title|aria-label|data-tooltip|data-tip)"
$urlishWords = "(https?:\/\/|google\.com\/maps|maps\.google|waze|mapbox|access_token|accessToken|encodeURI|encodeURIComponent|buildStaticMapUrl|smart|route|nav|mapUrl|directions)"

$patJsx = "(?is)\s+$attrs\s*=\s*\{[^}]*?$urlishWords[^}]*?\}"
$patHtmlDq = "(?is)\s+$attrs\s*=\s*`"[^`"]*?$urlishWords[^`"]*?`""
$patHtmlSq = "(?is)\s+$attrs\s*=\s*'[^']*?$urlishWords[^']*?'"

# Count matches first (PS5-safe)
$c1 = [regex]::Matches($txt, $patJsx).Count
$c2 = [regex]::Matches($txt, $patHtmlDq).Count
$c3 = [regex]::Matches($txt, $patHtmlSq).Count

Info ("[INFO] Matches: JSX={0}, HTML(dq)={1}, HTML(sq)={2}" -f $c1, $c2, $c3)

# Replace with safe tooltip text (same attribute name preserved)
# For JSX attrs: replace whole ' attr={...}' with ' attr="Open navigation in Maps"'
$txt = [regex]::Replace($txt, $patJsx, ' $1="Open navigation in Maps"')
$txt = [regex]::Replace($txt, $patHtmlDq, ' $1="Open navigation in Maps"')
$txt = [regex]::Replace($txt, $patHtmlSq, ' $1="Open navigation in Maps"')

# De-dupe double attrs if created (rare)
$txt = [regex]::Replace($txt, '(?is)(\s+title="Open navigation in Maps")(\s+title="Open navigation in Maps")+', '$1')
$txt = [regex]::Replace($txt, '(?is)(\s+aria-label="Open navigation in Maps")(\s+aria-label="Open navigation in Maps")+', '$1')
$txt = [regex]::Replace($txt, '(?is)(\s+data-tooltip="Open navigation in Maps")(\s+data-tooltip="Open navigation in Maps")+', '$1')
$txt = [regex]::Replace($txt, '(?is)(\s+data-tip="Open navigation in Maps")(\s+data-tip="Open navigation in Maps")+', '$1')

if ($txt -eq $orig) {
  throw "No changes applied. No URL-ish tooltip attributes found in TrackClient.tsx."
}

# Save UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt, $utf8NoBom)

Ok "[OK] Patched tooltip attributes and saved TrackClient.tsx"
Info "NEXT STEP REQUIRED: Restart dev server (Ctrl+C, then npm.cmd run dev)."
