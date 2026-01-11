# FIX-JRIDE_PHASE3H_LIVETRIPS_DISABLE_AUTOASSIGN_IF_BAD_COORDS_V2.ps1
# - Robustly patches the Auto-assign button even if JSX formatting changed
# - Adds/forces disabled={!canAutoAssign}
# - Adds conditional disabled styling (opacity/cursor/pointer-events)
# - Keeps everything else untouched

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

# 1) Ensure canAutoAssign uses hasValidCoords(t) (simple + safe)
$reCan = "(?m)^\s*const\s+canAutoAssign\s*=\s*.*?;\s*$"
if ($txt -match $reCan) {
  $txt = [regex]::Replace($txt, $reCan, "                  const canAutoAssign = hasValidCoords(t);")
  Ok "Rewrote canAutoAssign definition."
} else {
  Warn "No canAutoAssign definition line found; skipping rewrite."
}

# 2) Find the Auto-assign button block by locating the text "Auto-assign"
# Use regex index with ignore-case
$m = [regex]::Match($txt, "Auto-assign", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
if (!$m.Success) {
  # Dump helpful context automatically (no extra paste needed)
  Warn "Could not find text 'Auto-assign' in file. Showing matches for 'assign' for debugging:"
  Select-String -Path $target -Pattern "Auto-assign","auto-assign","AUTO_ASSIGN","assign" | Select-Object -First 40 | Format-Table LineNumber,Line -AutoSize | Out-String | Write-Host
  Fail "Auto-assign text not found."
}

$idx = $m.Index

# Walk back to nearest "<button"
$start = $txt.LastIndexOf("<button", $idx, [System.StringComparison]::OrdinalIgnoreCase)
if ($start -lt 0) {
  Fail "Found 'Auto-assign' but could not find a preceding <button tag."
}

# Walk forward to nearest "</button>"
$endClose = $txt.IndexOf("</button>", $idx, [System.StringComparison]::OrdinalIgnoreCase)
if ($endClose -lt 0) {
  Fail "Found 'Auto-assign' but could not find a closing </button>."
}
$end = $endClose + "</button>".Length

$btn = $txt.Substring($start, $end - $start)

# 3) Patch the opening tag to include disabled={!canAutoAssign} if missing
# Find end of opening <button ...>
$openEnd = $btn.IndexOf(">", [System.StringComparison]::Ordinal)
if ($openEnd -lt 0) { Fail "Malformed <button> tag (no '>')." }

$openTag = $btn.Substring(0, $openEnd + 1)
$rest = $btn.Substring($openEnd + 1)

if ($openTag -notmatch "disabled\s*=\s*\{\s*!\s*canAutoAssign\s*\}") {
  # Insert before '>' to avoid JSX weirdness
  $openTag = $openTag.Insert($openTag.Length - 1, " disabled={!canAutoAssign}")
  Ok "Inserted disabled={!canAutoAssign} on Auto-assign button."
} else {
  Ok "disabled={!canAutoAssign} already present on Auto-assign button."
}

# 4) Force/replace title prop for clearer UX (safe replace or add)
if ($openTag -match "title\s*=\s*\{") {
  $openTag = [regex]::Replace(
    $openTag,
    "title\s*=\s*\{[^}]*\}",
    'title={!canAutoAssign ? "Requires pickup & dropoff coordinates (not 0/0)" : "Auto-assign nearest driver"}'
  )
  Ok "Updated title prop."
} elseif ($openTag -match "title\s*=\s*""") {
  $openTag = [regex]::Replace(
    $openTag,
    'title\s*=\s*"[^"]*"',
    'title={!canAutoAssign ? "Requires pickup & dropoff coordinates (not 0/0)" : "Auto-assign nearest driver"}'
  )
  Ok "Replaced title string with conditional title."
} else {
  $openTag = $openTag.Insert($openTag.Length - 1, ' title={!canAutoAssign ? "Requires pickup & dropoff coordinates (not 0/0)" : "Auto-assign nearest driver"}')
  Ok "Added title prop."
}

# 5) Add conditional disabled styles
# Handle:
# - className="..."
# - className={...}
if ($openTag -match 'className\s*=\s*"\s*[^"]*"\s*') {
  $openTag = [regex]::Replace(
    $openTag,
    'className\s*=\s*"([^"]*)"',
    'className={`$1${!canAutoAssign ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}'
  )
  Ok "Converted className string -> template literal with disabled styling."
}
elseif ($openTag -match 'className\s*=\s*\{') {
  # Append concat to existing expression without breaking it
  $openTag = [regex]::Replace(
    $openTag,
    'className\s*=\s*\{([^}]*)\}',
    'className={$1 + (!canAutoAssign ? " opacity-40 cursor-not-allowed pointer-events-none" : "")}'
  )
  Ok "Appended disabled styling to className expression."
}
else {
  # No className at all: add one
  $openTag = $openTag.Insert(
    $openTag.Length - 1,
    ' className={`${!canAutoAssign ? "opacity-40 cursor-not-allowed pointer-events-none" : ""}`}'
  )
  Ok "Added className with disabled styling."
}

$btnNew = $openTag + $rest

# Replace in full file (only this exact block)
$txt2 = $txt.Substring(0, $start) + $btnNew + $txt.Substring($end)

# Write UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt2, $utf8NoBom)
Ok "Wrote: $target"

Ok "Done. Now run: npm run build"
