# FIX-JRIDE_PHASE3D_VENDORORDERS_FIELDS_PLACEMENT_V4.ps1
# PHASE_3D_TAKEOUT_COORDS_FIX
# Fix: remove misplaced coord fields inside schema-safe insert retry block, then insert into createPayload object.
# Backup before patch. UTF-8 no BOM. No auth/wallet/schema edits.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

function Backup-File($path){
  if(!(Test-Path $path)){ Fail "Missing file: $path" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak.$ts"
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Ok "Backup: $bak"
}

function Read-Text($path){
  Get-Content -LiteralPath $path -Raw
}

function Write-Utf8NoBom($path, $text){
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

$repo = (Get-Location).Path
$target = Join-Path $repo "app\api\vendor-orders\route.ts"

Info "Repo:   $repo"
Info "Target: $target"

Backup-File $target

$txt = Read-Text $target
$lines = $txt -split "`r?`n"

# 1) Remove misplaced block anywhere in file
$removed = 0
$out = New-Object System.Collections.Generic.List[string]

for ($i=0; $i -lt $lines.Length; $i++){
  $line = $lines[$i]

  if ($line -match "PHASE_3D_TAKEOUT_COORDS_FIX fields") {
    $removed++
    $skippedFields = 0
    $j = $i + 1
    while ($j -lt $lines.Length -and $skippedFields -lt 4) {
      $l2 = $lines[$j]
      if ($l2 -match "^\s*(pickup_lat|pickup_lng|dropoff_lat|dropoff_lng)\s*:") {
        $removed++
        $skippedFields++
        $j++
        continue
      }
      break
    }
    $i = $j - 1
    continue
  }

  if ($line -match "^\s*pickup_lat\s*:\s*vendorLL\.lat\s*,\s*$") { $removed++; continue }
  if ($line -match "^\s*pickup_lng\s*:\s*vendorLL\.lng\s*,\s*$") { $removed++; continue }
  if ($line -match "^\s*dropoff_lat\s*:\s*dropLL\.lat\s*,\s*$") { $removed++; continue }
  if ($line -match "^\s*dropoff_lng\s*:\s*dropLL\.lng\s*,\s*$") { $removed++; continue }

  $out.Add($line) | Out-Null
}

if ($removed -gt 0) {
  Ok "Removed $removed misplaced PHASE 3D line(s)."
} else {
  Warn "No misplaced PHASE 3D lines found (maybe already removed)."
}

$lines2 = $out.ToArray()

# 2) Insert fields into createPayload object
$already = $false
foreach ($l in $lines2) {
  if ($l -match "pickup_lat\s*:\s*vendorLL\.lat" -or $l -match "dropoff_lat\s*:\s*dropLL\.lat") { $already = $true; break }
}

if ($already) {
  Warn "createPayload already contains PHASE 3D fields; skipping insertion."
} else {
  $idxCreate = -1
  for ($k=0; $k -lt $lines2.Length; $k++){
    if ($lines2[$k] -match "^\s*const\s+createPayload\b") { $idxCreate = $k; break }
  }
  if ($idxCreate -lt 0) { Fail "Could not find 'const createPayload' in route.ts" }

  $idxBrace = -1
  for ($k=$idxCreate; $k -lt [Math]::Min($idxCreate + 6, $lines2.Length); $k++){
    if ($lines2[$k].Contains("{")) { $idxBrace = $k; break }
  }
  if ($idxBrace -lt 0) { Fail "Could not find opening '{' for createPayload near line $idxCreate" }

  $baseIndent = ""
  if ($lines2[$idxBrace] -match "^(\s*)") { $baseIndent = $Matches[1] }
  $fieldIndent = $baseIndent + "  "

  $inject = @(
    "${fieldIndent}// PHASE_3D_TAKEOUT_COORDS_FIX fields",
    "${fieldIndent}pickup_lat: vendorLL.lat,",
    "${fieldIndent}pickup_lng: vendorLL.lng,",
    "${fieldIndent}dropoff_lat: dropLL.lat,",
    "${fieldIndent}dropoff_lng: dropLL.lng,"
  )

  $final = New-Object System.Collections.Generic.List[string]
  for ($k=0; $k -lt $lines2.Length; $k++){
    $final.Add($lines2[$k]) | Out-Null
    if ($k -eq $idxBrace) {
      foreach ($x in $inject) { $final.Add($x) | Out-Null }
    }
  }

  $lines2 = $final.ToArray()
  Ok "Inserted PHASE 3D fields into createPayload object."
}

$txtOut = ($lines2 -join "`r`n")
Write-Utf8NoBom $target $txtOut
Ok "Wrote: $target (UTF-8 no BOM)"
Ok "Done. Now run build."
