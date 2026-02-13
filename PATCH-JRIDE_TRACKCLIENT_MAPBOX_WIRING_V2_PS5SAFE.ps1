# PATCH-JRIDE_TRACKCLIENT_MAPBOX_WIRING_V2_PS5SAFE.ps1
# Robust fix for TrackClient Mapbox:
# - Unify token usage (token vs MAPBOX_TOKEN) so UI doesn't say "missing" incorrectly.
# - If mapboxgl is used but not imported, add import mapboxgl from "mapbox-gl".
# - If new mapboxgl.Map is used, ensure mapboxgl.accessToken = token; before map init.
# PS5-safe with backup.

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$target = "app\ride\track\TrackClient.tsx"
if (!(Test-Path $target)) { throw "Target not found: $target" }

$bakDir = "_patch_bak"
if (!(Test-Path $bakDir)) { New-Item -ItemType Directory $bakDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $target "$bakDir\TrackClient.tsx.bak.$stamp" -Force
Ok "[OK] Backup: $bakDir\TrackClient.tsx.bak.$stamp"

$txt = Get-Content $target -Raw

# --- Step 1: Unify MAPBOX_TOKEN -> token (prevents UI mismatch) ---
if ($txt -match '\bMAPBOX_TOKEN\b') {
  # Remove MAPBOX_TOKEN declaration line if present
  $txt = $txt -replace '(?m)^\s*const\s+MAPBOX_TOKEN\s*=.*?;\s*$', ''
  # Replace remaining uses
  $txt = $txt -replace '\bMAPBOX_TOKEN\b', 'token'
  Ok "[OK] Unified MAPBOX_TOKEN -> token"
} else {
  Info "[INFO] No MAPBOX_TOKEN symbol found (skip unify)."
}

# Ensure token is defined from env (if missing)
if ($txt -notmatch '(?m)^\s*const\s+token\s*=') {
  # Insert token declaration after last import
  $lines = $txt -split "`r`n", -1
  $lastImport = -1
  for ($i=0; $i -lt $lines.Length; $i++) { if ($lines[$i] -match '^\s*import\s+') { $lastImport = $i } }
  if ($lastImport -lt 0) { throw "No import section found to insert token declaration." }

  $tokenDecl = @(
    '',
    '// JRIDE_TOKEN_DECL_BEGIN',
    'const token = (process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "") as string;',
    '// JRIDE_TOKEN_DECL_END',
    ''
  )

  $new = New-Object System.Collections.Generic.List[string]
  for ($i=0; $i -lt $lines.Length; $i++) {
    $new.Add($lines[$i])
    if ($i -eq $lastImport) { foreach ($t in $tokenDecl) { $new.Add($t) } }
  }
  $txt = $new -join "`r`n"
  Ok "[OK] Inserted token declaration from NEXT_PUBLIC_MAPBOX_* env"
} else {
  Info "[INFO] token declaration already exists (skip insert)."
}

# --- Step 2: If mapboxgl is used, ensure import exists ---
$usesMapboxgl = ($txt -match 'mapboxgl\.' -or $txt -match 'new\s+mapboxgl\.Map\s*\(')
$hasMapboxglImport = ($txt -match '(?m)^\s*import\s+.*\bfrom\s+["'']mapbox-gl["''];\s*$' -or
                     $txt -match '(?m)^\s*import\s+.*["'']mapbox-gl["''];\s*$')

if ($usesMapboxgl -and -not $hasMapboxglImport) {
  $lines = $txt -split "`r`n", -1
  $lastImport = -1
  for ($i=0; $i -lt $lines.Length; $i++) { if ($lines[$i] -match '^\s*import\s+') { $lastImport = $i } }
  if ($lastImport -lt 0) { throw "No import section found to insert mapbox-gl import." }

  $importLines = @(
    'import mapboxgl from "mapbox-gl";'
  )

  $new = New-Object System.Collections.Generic.List[string]
  for ($i=0; $i -lt $lines.Length; $i++) {
    $new.Add($lines[$i])
    if ($i -eq $lastImport) { foreach ($il in $importLines) { $new.Add($il) } }
  }
  $txt = $new -join "`r`n"
  Ok "[OK] Added import mapboxgl from mapbox-gl"
} elseif ($usesMapboxgl) {
  Info "[INFO] mapbox-gl import already present."
} else {
  Info "[INFO] TrackClient does not appear to use mapboxgl.* (static map mode)."
}

# --- Step 3: Ensure accessToken assignment before map init (only if map init exists) ---
if ($txt -match 'new\s+mapboxgl\.Map\s*\(') {
  if ($txt -notmatch 'mapboxgl\.accessToken\s*=') {
    $txt = [regex]::Replace(
      $txt,
      '(new\s+mapboxgl\.Map\s*\()',
      "mapboxgl.accessToken = token;`r`n`r`n`$1",
      1
    )
    Ok "[OK] Inserted mapboxgl.accessToken = token; before map init"
  } else {
    Info "[INFO] accessToken assignment already present."
  }
}

Set-Content $target $txt -Encoding UTF8
Ok "[OK] Patched: $target"
