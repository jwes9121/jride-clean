# FIX-JRIDE_PHASE3H_LIVETRIPS_DISABLE_AUTOASSIGN_IF_BAD_COORDS_V3.ps1
# Robust fix:
# - Ensures canAutoAssign = hasValidCoords(t)
# - Adds a HARD GUARD inside the AUTO_ASSIGN click handler:
#     if (!hasValidCoords(t)) return;
# - Best-effort: tries to add disabled={!canAutoAssign} on nearby <button> or <Button> tag

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$bak = "$target.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $target -Raw

# 0) Ensure hasValidCoords exists (if your V1/V2 already inserted it, we leave it alone)
if ($txt -notmatch "function\s+hasValidCoords\s*\(") {
  Warn "hasValidCoords() not found. (Your earlier logs said it exists; if not, stop here and paste around where you expect it.)"
}

# 1) Ensure canAutoAssign uses hasValidCoords(t)
$reCan = "(?m)^\s*const\s+canAutoAssign\s*=\s*.*?;\s*$"
if ($txt -match $reCan) {
  $txt = [regex]::Replace($txt, $reCan, "                  const canAutoAssign = hasValidCoords(t);")
  Ok "Rewrote canAutoAssign definition."
} else {
  Warn "No canAutoAssign definition line found; skipping rewrite."
}

# 2) Locate AUTO_ASSIGN call
$needle = 'callLiveTripsAction("AUTO_ASSIGN"'
$idx = $txt.IndexOf($needle, [System.StringComparison]::Ordinal)
if ($idx -lt 0) {
  # Try single quotes variant
  $needle2 = "callLiveTripsAction('AUTO_ASSIGN'"
  $idx = $txt.IndexOf($needle2, [System.StringComparison]::Ordinal)
  if ($idx -lt 0) {
    Warn "Could not find AUTO_ASSIGN call. Showing matches for AUTO_ASSIGN:"
    Select-String -Path $target -Pattern "AUTO_ASSIGN","Auto-assign","auto-assign","callLiveTripsAction" | Select-Object -First 60 |
      Format-Table LineNumber,Line -AutoSize | Out-String | Write-Host
    Fail "AUTO_ASSIGN call not found; cannot patch."
  } else {
    $needle = $needle2
  }
}
Ok "Found AUTO_ASSIGN call."

# 3) Walk backward to find the start of the nearest onClick handler block
# We search within a window before the AUTO_ASSIGN call for 'onClick' and the opening '{'
$winStart = [Math]::Max(0, $idx - 2200)
$chunk = $txt.Substring($winStart, $idx - $winStart)

$onClickIdxLocal = $chunk.LastIndexOf("onClick", [System.StringComparison]::Ordinal)
if ($onClickIdxLocal -lt 0) {
  Fail "Found AUTO_ASSIGN but could not find preceding 'onClick' within window."
}
$onClickIdx = $winStart + $onClickIdxLocal

# Find the '{' that opens the onClick handler expression: onClick={ ... }
$braceOpen = $txt.IndexOf("{", $onClickIdx, [System.StringComparison]::Ordinal)
if ($braceOpen -lt 0 -or $braceOpen -gt $idx) {
  Fail "Could not find '{' opening the onClick handler before AUTO_ASSIGN."
}

# Find the handler body start. Common patterns:
# onClick={() => { ... }}
# onClick={async () => { ... }}
# We'll locate the first '{' AFTER the arrow.
$arrowIdx = $txt.IndexOf("=>", $onClickIdx, [System.StringComparison]::Ordinal)
if ($arrowIdx -lt 0 -or $arrowIdx -gt $idx) {
  Fail "Could not find '=>' for the onClick handler near AUTO_ASSIGN."
}
$bodyStart = $txt.IndexOf("{", $arrowIdx, [System.StringComparison]::Ordinal)
if ($bodyStart -lt 0 -or $bodyStart -gt $idx) {
  Fail "Could not find '{' that starts the onClick body near AUTO_ASSIGN."
}

# 4) Insert guard at top of onClick body if not already present
$guard = 'if (!hasValidCoords(t)) return;'
$preBody = $txt.Substring($bodyStart, [Math]::Min(450, $txt.Length - $bodyStart))
if ($preBody -match "hasValidCoords\s*\(\s*t\s*\)") {
  Ok "Guard already present in onClick body (hasValidCoords(t)); skipping insert."
} else {
  $insertAt = $bodyStart + 1
  $txt = $txt.Substring(0, $insertAt) + "`n                                      $guard`n" + $txt.Substring($insertAt)
  Ok "Inserted guard inside AUTO_ASSIGN onClick handler."
}

# 5) Best-effort: add disabled={!canAutoAssign} on the nearest tag (<button or <Button) above AUTO_ASSIGN
# This is optional; handler guard is the real safety.
$winStart2 = [Math]::Max(0, $idx - 1800)
$chunk2 = $txt.Substring($winStart2, $idx - $winStart2)

$tagStartLocal = $chunk2.LastIndexOf("<button", [System.StringComparison]::OrdinalIgnoreCase)
$tagName = "button"
if ($tagStartLocal -lt 0) {
  $tagStartLocal = $chunk2.LastIndexOf("<Button", [System.StringComparison]::OrdinalIgnoreCase)
  $tagName = "Button"
}
if ($tagStartLocal -lt 0) {
  Warn "Could not find nearby <button>/<Button> tag to add disabled=. Handler guard will still block Auto-assign."
} else {
  $tagStart = $winStart2 + $tagStartLocal
  $tagEnd = $txt.IndexOf(">", $tagStart, [System.StringComparison]::Ordinal)
  if ($tagEnd -gt 0) {
    $openTag = $txt.Substring($tagStart, $tagEnd - $tagStart + 1)
    if ($openTag -notmatch "disabled\s*=\s*\{\s*!\s*canAutoAssign\s*\}") {
      $openTag2 = $openTag.Insert($openTag.Length - 1, " disabled={!canAutoAssign}")
      $txt = $txt.Substring(0, $tagStart) + $openTag2 + $txt.Substring($tagEnd + 1)
      Ok "Added disabled={!canAutoAssign} to nearest <$tagName> tag."
    } else {
      Ok "Nearest <$tagName> already has disabled={!canAutoAssign}."
    }
  } else {
    Warn "Found <$tagName> but could not find end-of-tag '>' to patch disabled."
  }
}

# Write UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt, $utf8NoBom)
Ok "Wrote: $target"

Ok "Done. Now run: npm run build"
