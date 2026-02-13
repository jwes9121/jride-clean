# PATCH-JRIDE_PHASE7A_FIX_TABS_AND_MARKER_ICON.ps1
# PHASE 7A — Fix LiveTrips tabs + driver marker icon fallback (FRONTEND ONLY)
# Touches ONLY:
#   - app\admin\livetrips\LiveTripsClient.tsx
#   - app\admin\livetrips\components\LiveTripsMap.tsx
# Does NOT touch APIs/DB.

$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }
function Backup($p){
  if(!(Test-Path -LiteralPath $p)){ Fail "Missing: $p" }
  $bak = "$p.bak.$(Stamp)"
  Copy-Item -LiteralPath $p -Destination $bak -Force
  Write-Host "[OK] Backup $bak"
}
function ReadRaw($p){ Get-Content -LiteralPath $p -Raw }
function WriteUtf8NoBom($p,$c){
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $c, $enc)
  Write-Host "[OK] Wrote $p"
}

$CLIENT = "app\admin\livetrips\LiveTripsClient.tsx"
$MAP    = "app\admin\livetrips\components\LiveTripsMap.tsx"
$ICON1  = "public\icons\jride-trike.png"

Backup $CLIENT
Backup $MAP

# -------------------------
# 1) LiveTripsClient.tsx
# -------------------------
$txt = ReadRaw $CLIENT

# A) Strengthen normStatus to normalize spaces/hyphens -> underscores
#    This fixes "on the way" vs "on_the_way" mismatches.
if ($txt -match "function\s+normStatus\s*\(") {
  # Replace function body (safe, anchored)
  $pattern = '(?s)function\s+normStatus\s*\(\s*s\?\:\s*any\s*\)\s*\{\s*return\s+String\(s\s*\|\|\s*""\)\.trim\(\)\.toLowerCase\(\)\;\s*\}'
  if ($txt -match $pattern) {
    $replacement = @'
function normStatus(s?: any) {
  const v = String(s || "").trim().toLowerCase();
  // Normalize variants: "on the way", "on-the-way" -> "on_the_way"
  return v
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
}
'@
    $txt = [regex]::Replace($txt, $pattern, $replacement, 1)
    Write-Host "[OK] normStatus upgraded (spaces/hyphens -> underscores)."
  } else {
    Write-Host "[WARN] normStatus signature differs; skipping normalization patch."
  }
} else {
  Fail "Could not find normStatus() in $CLIENT"
}

# B) Fix Problem tab: use computeIsProblem (and keep stuckTripIds as extra)
#    This makes list consistent with the problem count.
$problemBranchPattern = '(?s)\}\s*else\s+if\s*\(\s*f\s*===\s*"problem"\s*\)\s*\{\s*out\s*=\s*allTrips\.filter\(\(t\)\s*=>\s*stuckTripIds\.has\(normTripId\(t\)\)\);\s*\}'
if ($txt -match $problemBranchPattern) {
  $problemReplacement = @'
} else if (f === "problem") {
      out = allTrips.filter((t) => computeIsProblem(t) || stuckTripIds.has(normTripId(t)));
}
'@
  $txt = [regex]::Replace($txt, $problemBranchPattern, $problemReplacement, 1)
  Write-Host "[OK] Problem tab now filters by computeIsProblem OR stuckTripIds."
} else {
  Write-Host "[WARN] Could not find exact Problem-tab filter branch; attempting a looser patch..."

  # Looser: find `if (f === "problem") { out = ... }` and replace inside
  $loose = '(?s)(else\s+if\s*\(\s*f\s*===\s*"problem"\s*\)\s*\{\s*)(out\s*=\s*.*?;\s*)(\})'
  if ($txt -match $loose) {
    $txt = [regex]::Replace($txt, $loose, '${1}out = allTrips.filter((t) => computeIsProblem(t) || stuckTripIds.has(normTripId(t)));' + "`n    " + '${3}', 1)
    Write-Host "[OK] Problem tab patched (loose match)."
  } else {
    Fail "Could not patch Problem-tab filter in $CLIENT. Paste the visibleTrips useMemo block."
  }
}

# C) Fix PROBLEM badge in table row: it currently uses stuckTripIds only.
#    Make it consistent: computeIsProblem OR stuckTripIds.
if ($txt -match 'const\s+isProblem\s*=\s*stuckTripIds\.has\(id\);') {
  $txt = $txt -replace 'const\s+isProblem\s*=\s*stuckTripIds\.has\(id\);', 'const isProblem = computeIsProblem(t) || stuckTripIds.has(id);'
  Write-Host "[OK] PROBLEM badge now matches computeIsProblem()."
} else {
  Write-Host "[WARN] Could not find isProblem = stuckTripIds.has(id) line; skipping badge consistency patch."
}

WriteUtf8NoBom $CLIENT $txt

# -------------------------
# 2) LiveTripsMap.tsx
# -------------------------
$map = ReadRaw $MAP

# Quick check for icon file existence (helps diagnose 404)
if (!(Test-Path -LiteralPath $ICON1)) {
  Write-Host "[WARN] Missing icon file: $ICON1"
  Write-Host "       If the marker requests /icons/jride-trike.png, it will 404 and appear missing."
}

# Add a safe onerror fallback after the marker img src line (only once)
$needle = 'el.src = "/icons/jride-trike.png";'
if ($map -notmatch [regex]::Escape($needle)) {
  Write-Host "[WARN] Could not find marker src line: $needle"
  Write-Host "       If your map uses a different icon path, paste the marker creation block and I’ll patch the correct needle."
} else {
  if ($map -notmatch "JRIDE_PHASE7A_ICON_FALLBACK") {
    $fallback = @'
          // JRIDE_PHASE7A_ICON_FALLBACK
          try {
            (el as any).referrerPolicy = "no-referrer";
          } catch (_) {}
          el.onerror = () => {
            // Fallback to a built-in marker look so the driver never disappears
            try {
              el.removeAttribute("src");
            } catch (_) {}
            el.style.width = "18px";
            el.style.height = "18px";
            el.style.borderRadius = "9999px";
            el.style.background = "#111827"; // near-black
            el.style.border = "2px solid white";
            el.style.boxShadow = "0 0 0 4px rgba(59,130,246,0.30)";
          };
'@
    $map = $map -replace [regex]::Escape($needle), ($needle + "`n" + $fallback)
    Write-Host "[OK] Added driver icon fallback (onerror) so marker never disappears."
    WriteUtf8NoBom $MAP $map
  } else {
    Write-Host "[OK] Icon fallback already present; skipping."
  }
}

Write-Host ""
Write-Host "[DONE] PHASE 7A fix applied: Problem tab + On-the-way normalization + marker fallback."
