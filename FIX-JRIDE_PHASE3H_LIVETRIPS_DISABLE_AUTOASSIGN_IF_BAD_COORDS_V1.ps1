# FIX-JRIDE_PHASE3H_LIVETRIPS_DISABLE_AUTOASSIGN_IF_BAD_COORDS_V1.ps1
# - Hard-disable Auto-assign when coords are missing or 0/0
# - Ensures hasValidCoords() exists
# - Only touches: app\admin\livetrips\LiveTripsClient.tsx

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$bak = "$target.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $target -Raw

# 1) Ensure hasValidCoords exists (insert near other helpers; after hasDriver() if present; else after normStatus())
if ($txt -notmatch "function\s+hasValidCoords\s*\(") {

  $helper = @'
function hasValidCoords(t: any): boolean {
  const pLat = Number((t as any)?.pickup_lat ?? (t as any)?.pickupLatitude ?? null);
  const pLng = Number((t as any)?.pickup_lng ?? (t as any)?.pickupLongitude ?? null);
  const dLat = Number((t as any)?.dropoff_lat ?? (t as any)?.dropoffLatitude ?? null);
  const dLng = Number((t as any)?.dropoff_lng ?? (t as any)?.dropoffLongitude ?? null);

  function ok(n: any) {
    return typeof n === "number" && Number.isFinite(n);
  }

  // must have both pickup and dropoff coords
  if (!ok(pLat) || !ok(pLng) || !ok(dLat) || !ok(dLng)) return false;

  // reject 0/0 placeholders
  if ((pLat === 0 && pLng === 0) || (dLat === 0 && dLng === 0)) return false;

  return true;
}

'@

  # Prefer insert after hasDriver() helper if found
  $m1 = [regex]::Match($txt, "(?s)function\s+hasDriver\s*\([^)]*\)\s*\{.*?\}\s*")
  if ($m1.Success) {
    $txt = $txt.Substring(0, $m1.Index + $m1.Length) + "`r`n" + $helper + $txt.Substring($m1.Index + $m1.Length)
    Ok "Inserted hasValidCoords() after hasDriver()."
  } else {
    # fallback insert after normStatus()
    $m2 = [regex]::Match($txt, "(?s)function\s+normStatus\s*\([^)]*\)\s*\{.*?\}\s*")
    if (!$m2.Success) { Fail "Could not find a safe helper insertion point (hasDriver/normStatus)." }
    $txt = $txt.Substring(0, $m2.Index + $m2.Length) + "`r`n" + $helper + $txt.Substring($m2.Index + $m2.Length)
    Ok "Inserted hasValidCoords() after normStatus()."
  }
} else {
  Ok "hasValidCoords() already exists; skipping insert."
}

# 2) Force canAutoAssign to require valid coords (and optionally require no driver linked)
# Replace: const canAutoAssign = hasValidCoords(t);
# or any existing canAutoAssign assignment in the trip row render
$txt2 = $txt

# Replace a line like: const canAutoAssign = ...
$re = "(?m)^\s*const\s+canAutoAssign\s*=\s*.*?;\s*$"
if ($txt2 -match $re) {
  $txt2 = [regex]::Replace($txt2, $re, "                  const canAutoAssign = hasValidCoords(t);")
  Ok "Rewrote canAutoAssign definition."
} else {
  Ok "No canAutoAssign line found; leaving as-is."
}

# 3) Patch the Auto-assign button to hard-style disabled state
# Find the button that contains '>Auto-assign<'
$btnRe = "(?s)<button([^>]*?)>\s*Auto-assign\s*</button>"
$mBtn = [regex]::Match($txt2, $btnRe)
if (!$mBtn.Success) {
  Fail "Could not find the Auto-assign <button> block. Paste the section around it if this persists."
}

$oldBtn = $mBtn.Value

# If it already has disabled={!canAutoAssign}, keep it but enforce disabled styling
# We'll replace className=... with className including disabled styles
if ($oldBtn -notmatch "disabled\s*=\s*\{\s*!\s*canAutoAssign\s*\}") {
  # add disabled prop
  $oldBtn2 = $oldBtn -replace "<button", "<button disabled={!canAutoAssign}"
  $oldBtn = $oldBtn2
}

# enforce className includes disabled style
if ($oldBtn -match 'className=\{[^}]+\}') {
  $oldBtn = [regex]::Replace(
    $oldBtn,
    'className=\{([^}]+)\}',
    'className={$1 + (!canAutoAssign ? " opacity-40 cursor-not-allowed pointer-events-none" : "")}'
  )
} elseif ($oldBtn -match 'className="[^"]*"') {
  $oldBtn = [regex]::Replace(
    $oldBtn,
    'className="([^"]*)"',
    'className="$1' + ' ' + '" + (!canAutoAssign ? "opacity-40 cursor-not-allowed pointer-events-none" : "") + "'
  )
} else {
  # add a basic className if none exists
  $oldBtn = $oldBtn -replace "<button", '<button className={"' + ' ' + '" + (!canAutoAssign ? "opacity-40 cursor-not-allowed pointer-events-none" : "") + "' + ' ' + '"}'
}

# Ensure title matches lock reason
$oldBtn = [regex]::Replace(
  $oldBtn,
  'title=\{[^}]+\}',
  'title={!canAutoAssign ? "Requires pickup & dropoff coordinates (not 0/0)" : "Auto-assign nearest driver"}'
)

# Apply replacement
$txt2 = $txt2.Substring(0, $mBtn.Index) + $oldBtn + $txt2.Substring($mBtn.Index + $mBtn.Length)
Ok "Patched Auto-assign button to hard-disable + grey style when coords invalid."

# Write back UTF-8 (no BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt2, $utf8NoBom)
Ok "Wrote: $target"

Ok "Done. Now run: npm run build"
