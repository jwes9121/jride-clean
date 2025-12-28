# FIX-JRIDE_PHASE7C_SYNTAX_RECOVERY_LIVETRIPSCLIENT.ps1
# Phase 7C: Syntax recovery only (NO REGEX, NO MASS REPLACE)
# - Removes broken dangling ternary debris
# - Fixes missing newline in visibleTrips.map guard

$ErrorActionPreference = "Stop"

function Fail($m) { throw "[FAIL] $m" }
function Ok($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }

# --- Paths (repo root assumed as current directory) ---
$relPath = "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $relPath)) {
  Fail "File not found: $relPath (run this from repo root)."
}

# --- Backup ---
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bakPath = "$relPath.bak.$stamp"
Copy-Item -LiteralPath $relPath -Destination $bakPath -Force
Ok "Backup created: $bakPath"

# --- Read ---
$txt = Get-Content -LiteralPath $relPath -Raw

# --- Fix 1: Remove dangling debris block ---
# EXACT fragment to remove (as seen in the broken file)
$debris = @"
: (t as any)
    )
  );
}
"@

if ($txt.Contains($debris)) {
  $txt = $txt.Replace($debris, "")
  Ok "Removed dangling debris fragment."
} else {
  # Sometimes indentation differs slightly; try a second exact variant with CRLF normalization
  $txtNL = $txt.Replace("`r`n","`n")
  $debrisNL = $debris.Replace("`r`n","`n")
  if ($txtNL.Contains($debrisNL)) {
    $txtNL = $txtNL.Replace($debrisNL, "")
    $txt = $txtNL.Replace("`n","`r`n")
    Ok "Removed dangling debris fragment (normalized newlines)."
  } else {
    Fail "Could not find the exact dangling debris fragment to remove. No changes made beyond backup."
  }
}

# --- Fix 2: Insert missing newline before const id ---
$badJoin = "}" + "const id = normTripId(t);"
$goodJoin = "}`r`n`r`nconst id = normTripId(t);"

if ($txt.Contains($badJoin)) {
  $txt = $txt.Replace($badJoin, $goodJoin)
  Ok "Fixed missing newline before const id."
} else {
  # Also handle if file uses LF only
  $txtNL = $txt.Replace("`r`n","`n")
  $goodJoinNL = "}`n`nconst id = normTripId(t);"
  if ($txtNL.Contains($badJoin)) {
    $txtNL = $txtNL.Replace($badJoin, $goodJoinNL)
    $txt = $txtNL.Replace("`n","`r`n")
    Ok "Fixed missing newline before const id (normalized newlines)."
  } else {
    Fail "Could not find the exact `}const id = normTripId(t);` join to fix. No file write performed."
  }
}

# --- Write back ---
Set-Content -LiteralPath $relPath -Value $txt -Encoding UTF8
Ok "Patched file written: $relPath"

# --- Quick sanity hint ---
Write-Host ""
Write-Host "Next run:" -ForegroundColor Cyan
Write-Host "  npm run build" -ForegroundColor White
