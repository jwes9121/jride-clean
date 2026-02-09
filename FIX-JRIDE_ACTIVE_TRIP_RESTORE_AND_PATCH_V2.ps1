# FIX-JRIDE_ACTIVE_TRIP_RESTORE_AND_PATCH_V2.ps1
# Restores the latest backup of app\api\driver\active-trip\route.ts
# Then applies:
#  - Add "fare_proposed" to activeStatuses
#  - Inject guard helpers
#  - Patch the first "Prefer non-assigned active states first" loop using brace matching (no regex block hacks)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host $m -ForegroundColor Red; exit 1 }

function Find-MatchingBraceIndex {
  param(
    [Parameter(Mandatory=$true)][string]$Text,
    [Parameter(Mandatory=$true)][int]$OpenIndex
  )
  if ($OpenIndex -lt 0 -or $OpenIndex -ge $Text.Length) { return -1 }
  if ($Text[$OpenIndex] -ne '{') { return -1 }

  $depth = 0
  for ($i = $OpenIndex; $i -lt $Text.Length; $i++) {
    $ch = $Text[$i]
    if ($ch -eq '{') { $depth++ }
    elseif ($ch -eq '}') {
      $depth--
      if ($depth -eq 0) { return $i }
    }
  }
  return -1
}

$RepoRoot = (Get-Location).Path
$Rel = "app\api\driver\active-trip\route.ts"
$File = Join-Path $RepoRoot $Rel

if (-not (Test-Path -LiteralPath $File)) {
  Die "[FAIL] Missing file: $File (run this from your Next.js repo root)"
}

$BakDir = Join-Path $RepoRoot "_patch_bak"
if (-not (Test-Path -LiteralPath $BakDir)) {
  Die "[FAIL] Missing backup folder: $BakDir"
}

# Pick latest backup that matches active-trip
$bak = Get-ChildItem -LiteralPath $BakDir -File |
  Where-Object { $_.Name -like "active-trip.route.ts.bak.*" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $bak) {
  Die "[FAIL] No backups found matching: active-trip.route.ts.bak.*"
}

Copy-Item -LiteralPath $bak.FullName -Destination $File -Force
Ok ("[OK] Restored from backup: " + $bak.FullName)

# Read restored content
$src = Get-Content -LiteralPath $File -Raw -Encoding UTF8

# 1) Ensure fare_proposed in activeStatuses
$m = [regex]::Match($src, 'const\s+activeStatuses\s*=\s*\[(?<arr>[^\]]*)\]\s*;?', 'Singleline')
if (-not $m.Success) {
  Die "[FAIL] Could not locate activeStatuses array."
}

$arrText = $m.Groups["arr"].Value
if ($arrText -notmatch '"fare_proposed"') {
  # Insert after "accepted" if present, else prepend
  if ($arrText -match '"accepted"\s*,') {
    $arrText2 = [regex]::Replace($arrText, '"accepted"\s*,', '"accepted", "fare_proposed",', 1)
  } else {
    $arrText2 = '"fare_proposed", ' + $arrText.Trim()
  }
  $newDecl = $m.Value -replace [regex]::Escape($m.Groups["arr"].Value), [regex]::Escape($arrText2)
  # Above produced escaped content; do direct rebuild instead:
  $newDecl = 'const activeStatuses = [' + $arrText2.Trim() + '];'
  # Replace whole declaration span safely:
  $src = $src.Substring(0, $m.Index) + $newDecl + $src.Substring($m.Index + $m.Length)
  Ok "[OK] Added fare_proposed to activeStatuses."
} else {
  Warn "[WARN] fare_proposed already present."
}

# Re-find declaration to inject helpers just after it
$m2 = [regex]::Match($src, 'const\s+activeStatuses\s*=\s*\[[^\]]*\]\s*;?', 'Singleline')
if (-not $m2.Success) { Die "[FAIL] Could not re-locate activeStatuses after edit." }

if ($src -notmatch 'function\s+hasFareEvidence\s*\(') {
  $guardBlock = @'
    
    // Fare-evidence guard:
    // If a trip claims it's already in movement states but has no fare data at all,
    // treat it as stale/invalid so it doesn't haunt the driver forever.
    function hasFareEvidence(r: any): boolean {
      const pf = (r as any)?.proposed_fare;
      const vf = (r as any)?.verified_fare;
      const pr = (r as any)?.passenger_fare_response;
      return pf != null || vf != null || pr != null;
    }

    function isMovementState(st: string): boolean {
      return st === "on_the_way" || st === "arrived" || st === "on_trip";
    }

'@

  $insertAt = $m2.Index + $m2.Length
  $src = $src.Insert($insertAt, $guardBlock)
  Ok "[OK] Injected guard helpers."
} else {
  Warn "[WARN] Guard helpers already exist."
}

# 3) Patch the first preference loop using brace matching
$anchor = "// 1) Prefer non-assigned active states first"
$anchorIdx = $src.IndexOf($anchor)
if ($anchorIdx -lt 0) {
  Die "[FAIL] Could not find anchor comment: $anchor"
}

# Find the next "for (const r of rows)" after anchor
$forNeedle = "for (const r of rows)"
$forIdx = $src.IndexOf($forNeedle, $anchorIdx)
if ($forIdx -lt 0) {
  Die "[FAIL] Could not find '$forNeedle' after anchor."
}

# Find the opening brace of that for-loop
$openBraceIdx = $src.IndexOf("{", $forIdx)
if ($openBraceIdx -lt 0) { Die "[FAIL] Could not find opening brace for the loop." }

$closeBraceIdx = Find-MatchingBraceIndex -Text $src -OpenIndex $openBraceIdx
if ($closeBraceIdx -lt 0) { Die "[FAIL] Could not match closing brace for the loop." }

# Replace from the anchor line start up to the end of the loop block
$anchorLineStart = $src.LastIndexOf("`n", $anchorIdx)
if ($anchorLineStart -lt 0) { $anchorLineStart = 0 } else { $anchorLineStart += 1 }

$replacement = @'
    // 1) Prefer non-assigned active states first (guard invalid movement states without fare)
    for (const r of rows) {
      const st = String((r as any)?.status ?? "");
      if (!st || st === "assigned") continue;

      // If status claims movement but no fare was ever proposed/verified/responded to,
      // ignore it (prevents "stuck on_the_way" ghosts).
      if (isMovementState(st) && !hasFareEvidence(r)) continue;

      picked = r;
      break;
    }
'@

$src = $src.Substring(0, $anchorLineStart) + $replacement + $src.Substring($closeBraceIdx + 1)
Ok "[OK] Patched loop block with brace matching."

# Write final
Set-Content -LiteralPath $File -Value $src -Encoding UTF8
Ok ("[OK] Wrote: " + $File)
Ok "== DONE =="
