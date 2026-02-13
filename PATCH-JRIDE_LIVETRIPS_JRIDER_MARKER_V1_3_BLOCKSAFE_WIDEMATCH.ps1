# PATCH-JRIDE_LIVETRIPS_JRIDER_MARKER_V1_3_BLOCKSAFE_WIDEMATCH.ps1
# Goal: Auto-find LiveTripsMap.tsx and unify DRIVER marker icon to production JRider marker
# Safety: patch ONLY inside // DRIVER marker block, no layout changes
# Also: if no recognizable icon assignment found, prints the DRIVER block for diagnosis and exits.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ok($m)   { Write-Host $m -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }
function Die($m)  { Write-Host $m -ForegroundColor Red; exit 1 }

$RepoRoot = (Get-Location).Path
try { $null = git rev-parse --is-inside-work-tree 2>$null } catch { }

function Resolve-LiveTripsMapFile {
  param([string]$Root)

  $candidates = @()

  try {
    $gitHits = git ls-files "*LiveTripsMap.tsx" 2>$null
    if ($gitHits) {
      $gitHits -split "`n" | ForEach-Object {
        $p = $_.Trim()
        if ($p) { $candidates += (Join-Path $Root $p) }
      }
    }
  } catch {}

  if ($candidates.Count -gt 0) {
    $preferred = $candidates | Where-Object { $_ -match '\\app\\admin\\livetrips\\' -or $_ -match '\\admin\\livetrips\\' }
    if ($preferred.Count -gt 0) { return $preferred[0] }
    return $candidates[0]
  }

  $fsHits = Get-ChildItem -Path $Root -Recurse -File -Filter "LiveTripsMap.tsx" -ErrorAction SilentlyContinue
  if ($fsHits -and $fsHits.Count -gt 0) {
    $preferred2 = $fsHits | Where-Object { $_.FullName -match '\\app\\admin\\livetrips\\' -or $_.FullName -match '\\admin\\livetrips\\' }
    if ($preferred2.Count -gt 0) { return $preferred2[0].FullName }
    return $fsHits[0].FullName
  }

  return $null
}

$Target = Resolve-LiveTripsMapFile -Root $RepoRoot
if (!$Target) { Die "[FAIL] Could not locate LiveTripsMap.tsx under repo root." }

Ok ("[OK] Target: {0}" -f $Target)

# Backup
$BakDir = Join-Path $RepoRoot "_patch_bak"
if (!(Test-Path $BakDir)) { New-Item -ItemType Directory -Path $BakDir | Out-Null }
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BakPath = Join-Path $BakDir ("LiveTripsMap.tsx.bak.{0}" -f $Stamp)
Copy-Item -LiteralPath $Target -Destination $BakPath -Force
Ok ("[OK] Backup: {0}" -f $BakPath)

# Read raw
$src = Get-Content -LiteralPath $Target -Raw

# Constants (insert once after accessToken line)
$constMarkerSrc  = 'const JRIDER_MARKER_SRC = "https://app.jride.net/markers/jrider-trike-72-pop.png?v=72";'
$constMarkerSize = 'const JRIDER_MARKER_SIZE_PX = 42;'

if ($src -notmatch [regex]::Escape($constMarkerSrc)) {
  $anchor = 'mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";'
  $anchorEsc = [regex]::Escape($anchor)

  if ($src -notmatch $anchorEsc) {
    Die "[FAIL] Could not find mapboxgl.accessToken anchor line. Refusing to guess insertion point."
  }

  $insert = @"
$anchor

$constMarkerSrc
$constMarkerSize
"@
  $src = [regex]::Replace($src, $anchorEsc, $insert, 1)
  Ok "[OK] Inserted JRIDER marker constants."
} else {
  Warn "[WARN] JRIDER_MARKER_SRC already present (skipping constants insert)."
}

# ---- Locate DRIVER marker block ----
# from "// DRIVER marker" up to "// PICKUP"
$blockPattern = '(?s)(//\s*DRIVER\s*marker.*?)(//\s*PICKUP)'
$m = [regex]::Match($src, $blockPattern)
if (!$m.Success) {
  Die "[FAIL] Could not locate DRIVER marker block (// DRIVER marker ... // PICKUP)."
}

$driverBlock = $m.Groups[1].Value
$blockTail   = $m.Groups[2].Value

$patched = $driverBlock
$changed = $false

# Helper: replace first match in block
function Replace-FirstInBlock {
  param(
    [string]$Block,
    [string]$Pattern,
    [string]$Replacement,
    [string]$OkMsg
  )
  if ([regex]::IsMatch($Block, $Pattern)) {
    $out = [regex]::Replace($Block, $Pattern, $Replacement, 1)
    Ok $OkMsg
    return ,@($out, $true)
  }
  return ,@($Block, $false)
}

# 1) el.src = ...;  (ANY RHS)
$r = Replace-FirstInBlock -Block $patched `
  -Pattern 'el\.src\s*=\s*[^;]+;' `
  -Replacement 'el.src = JRIDER_MARKER_SRC;' `
  -OkMsg '[OK] Patched driver icon via el.src = ... (any RHS) inside DRIVER marker block.'
$patched = $r[0]; if ($r[1]) { $changed = $true }

# 2) el.setAttribute("src", ...);  (ANY RHS) -> el.src = JRIDER_MARKER_SRC;
if (-not $changed) {
  $r = Replace-FirstInBlock -Block $patched `
    -Pattern 'el\.setAttribute\(\s*["'']src["'']\s*,\s*[^)]+\)\s*;' `
    -Replacement 'el.src = JRIDER_MARKER_SRC;' `
    -OkMsg '[OK] Patched driver icon via el.setAttribute("src", ...) inside DRIVER marker block.'
  $patched = $r[0]; if ($r[1]) { $changed = $true }
}

# 3) el.style.backgroundImage = ...;  -> url(JRIDER_MARKER_SRC)
if (-not $changed) {
  $r = Replace-FirstInBlock -Block $patched `
    -Pattern 'el\.style\.backgroundImage\s*=\s*[^;]+;' `
    -Replacement 'el.style.backgroundImage = "url(" + JRIDER_MARKER_SRC + ")";' `
    -OkMsg '[OK] Patched driver icon via el.style.backgroundImage inside DRIVER marker block.'
  $patched = $r[0]; if ($r[1]) { $changed = $true }
}

# 4) el.style.background = ...; -> url(JRIDER_MARKER_SRC)
if (-not $changed) {
  $r = Replace-FirstInBlock -Block $patched `
    -Pattern 'el\.style\.background\s*=\s*[^;]+;' `
    -Replacement 'el.style.background = "url(" + JRIDER_MARKER_SRC + ")";' `
    -OkMsg '[OK] Patched driver icon via el.style.background inside DRIVER marker block.'
  $patched = $r[0]; if ($r[1]) { $changed = $true }
}

# 5) replace any literal old path inside block (extra safety)
# If you have some other assignment, but it contains "/icons/jride-trike.png" somewhere, swap the literal only
if (-not $changed) {
  if ($patched -match '/icons/jride-trike\.png') {
    $patched = $patched -replace '/icons/jride-trike\.png', '" + JRIDER_MARKER_SRC + "'
    Ok '[OK] Replaced "/icons/jride-trike.png" literal inside DRIVER marker block.'
    $changed = $true
  }
}

# If still not changed: print block and fail (so you can paste here)
if (-not $changed) {
  Write-Host "`n==== DRIVER MARKER BLOCK (for diagnosis) ====" -ForegroundColor Yellow
  Write-Host $driverBlock
  Write-Host "==== END DRIVER MARKER BLOCK ====`n" -ForegroundColor Yellow
  Die "[FAIL] No recognizable icon assignment found inside DRIVER marker block. Block printed above."
}

# Standardize sizing ONLY if exact literal 42px lines exist inside this block
$didSize = $false
$wOld = 'el.style.width = "42px";'
$hOld = 'el.style.height = "42px";'
$wNew = 'el.style.width = JRIDER_MARKER_SIZE_PX + "px";'
$hNew = 'el.style.height = JRIDER_MARKER_SIZE_PX + "px";'

if ($patched -match [regex]::Escape($wOld)) { $patched = $patched -replace [regex]::Escape($wOld), $wNew; $didSize = $true }
if ($patched -match [regex]::Escape($hOld)) { $patched = $patched -replace [regex]::Escape($hOld), $hNew; $didSize = $true }

if ($didSize) { Ok "[OK] Standardized marker sizing to JRIDER_MARKER_SIZE_PX (42px) inside DRIVER marker block." }
else { Warn "[WARN] Did not find literal 42px sizing lines inside DRIVER marker block; leaving sizing unchanged." }

# Rebuild full file
$src = $src.Substring(0, $m.Index) + $patched + $blockTail + $src.Substring($m.Index + $m.Length)

# Write back UTF-8 (no BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($Target, $src, $utf8NoBom)

Ok "[OK] Patched successfully."
