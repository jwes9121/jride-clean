# PATCH-JRIDE_TRACKCLIENT_DRIVER_MARKER_SIZE_60PX_V1_PS5SAFE.ps1
# Goal: Make JRider logo marker a little larger than other markers on static map (better on mobile).
# Action:
#   1) Resize public\markers\jrider-trike.png -> public\markers\jrider-trike-60.png (60x60)
#   2) Patch app\ride\track\TrackClient.tsx to use /markers/jrider-trike-60.png
# PS5-safe, backups, UTF-8 no BOM.

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = (Get-Location).Path

$pngBaseRel = "public\markers\jrider-trike.png"
$pngOutRel  = "public\markers\jrider-trike-60.png"

$pngBase = Join-Path $root $pngBaseRel
$pngOut  = Join-Path $root $pngOutRel

$tsRel = "app\ride\track\TrackClient.tsx"
$ts    = Join-Path $root $tsRel

Info "== JRide Patch: Resize JRider marker to 60px + update TrackClient (V1 / PS5-safe) =="

if (!(Test-Path $pngBase)) { throw "Missing base marker: $pngBaseRel" }
if (!(Test-Path $ts))      { throw "Missing file: $tsRel (run from repo root)" }

# Backup folder
$bakDir = Join-Path $root "_patch_bak"
if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"

# Backups
$pngBak = Join-Path $bakDir ("jrider-trike.png.bak." + $stamp)
Copy-Item -LiteralPath $pngBase -Destination $pngBak -Force
Ok "[OK] Backup marker: $pngBak"

$tsBak = Join-Path $bakDir ("TrackClient.tsx.bak." + $stamp)
Copy-Item -LiteralPath $ts -Destination $tsBak -Force
Ok "[OK] Backup TS: $tsBak"

# Resize PNG using System.Drawing (Windows / PS5)
Add-Type -AssemblyName System.Drawing

$size = 60

$src = [System.Drawing.Image]::FromFile($pngBase)
try {
  $dstBmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $g = [System.Drawing.Graphics]::FromImage($dstBmp)
    try {
      $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.Clear([System.Drawing.Color]::Transparent)

      # Fit image into NxN while preserving aspect ratio
      $scale = [Math]::Min($size / $src.Width, $size / $src.Height)
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

    $dstBmp.Save($pngOut, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $dstBmp.Dispose()
  }
} finally {
  $src.Dispose()
}

Ok "[OK] Wrote resized marker: $pngOutRel (60x60)"

# Patch TrackClient to use the 60px marker
$txt  = Get-Content -Raw -LiteralPath $ts
$orig = $txt

# Replace any prior jrider marker variants to 60
$txt = [regex]::Replace($txt, 'jrider-trike-(\d+)\.png', 'jrider-trike-60.png')
$txt = [regex]::Replace($txt, 'jrider-trike\.png', 'jrider-trike-60.png')

if ($txt -eq $orig) {
  throw "No changes applied to TrackClient.tsx (could not find jrider-trike*.png reference)."
}

# Save TS UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($ts, $txt, $utf8NoBom)
Ok "[OK] Patched: $tsRel (now uses jrider-trike-60.png)"

Info "NEXT: Build + deploy so production can load https://app.jride.net/markers/jrider-trike-60.png"
