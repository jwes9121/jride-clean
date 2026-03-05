param(
  [Parameter(Mandatory=$true)][string]$WebRoot
)

$ErrorActionPreference="Stop"
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

function Write-Utf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

Write-Host "== FIX JRIDE: Restore passenger-signup/page.tsx backup + remove duplicate Town section safely (V1 / PS5-safe) =="

$targetRel = "app\passenger-signup\page.tsx"
$target = Join-Path $WebRoot $targetRel
if (!(Test-Path -LiteralPath $target)) { throw "Target not found: $target" }

$bakDir = Join-Path $WebRoot "_patch_bak"
if (!(Test-Path -LiteralPath $bakDir)) { throw "Backup folder not found: $bakDir" }

# Prefer the newest backup from the dedup scripts we ran
$candidates = @()
$candidates += Get-ChildItem -LiteralPath $bakDir -File -Filter "page.tsx.bak.PASSENGER_SIGNUP_DEDUP_TOWN_V1_1.*" -ErrorAction SilentlyContinue
$candidates += Get-ChildItem -LiteralPath $bakDir -File -Filter "page.tsx.bak.PASSENGER_SIGNUP_DEDUP_TOWNREQ_V1.*" -ErrorAction SilentlyContinue
$candidates += Get-ChildItem -LiteralPath $bakDir -File -Filter "page.tsx.bak.PASSENGER_SIGNUP_FIX_V1.*" -ErrorAction SilentlyContinue

if (!$candidates -or $candidates.Count -eq 0) {
  throw "No suitable passenger-signup backups found in $bakDir (expected page.tsx.bak.PASSENGER_*)."
}

$latest = $candidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host "[OK] Restoring from backup: $($latest.FullName)"

Copy-Item -LiteralPath $latest.FullName -Destination $target -Force
Write-Host "[OK] Restored: $target"

# Now patch safely: operate ONLY inside the JSX returned by return ( ... );
$src  = Get-Content -LiteralPath $target -Raw -Encoding UTF8
$orig = $src

# Find "return (" and the matching ");" AFTER it (first occurrence)
$ri = $src.IndexOf("return (", [System.StringComparison]::Ordinal)
if ($ri -lt 0) { throw "Could not find 'return (' in page.tsx" }

$afterReturn = $ri + "return (".Length
$end = $src.IndexOf(");", $afterReturn, [System.StringComparison]::Ordinal)
if ($end -lt 0) { throw "Could not find closing ');' after return block. File shape unexpected." }

$before = $src.Substring(0, $afterReturn)
$jsx    = $src.Substring($afterReturn, $end - $afterReturn)
$after  = $src.Substring($end)

# Count "Town of origin" occurrences in JSX only
$needle = "Town of origin"
$idx1 = $jsx.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase)
if ($idx1 -lt 0) { throw "No 'Town of origin' found inside JSX; cannot dedup." }

$idx2 = $jsx.IndexOf($needle, $idx1 + $needle.Length, [System.StringComparison]::OrdinalIgnoreCase)
if ($idx2 -lt 0) {
  Write-Host "[OK] Only one Town block found in JSX. Nothing to remove."
  Write-Utf8NoBom $target $src
  exit 0
}

# CUT RANGE inside JSX:
# Start = nearest "<div" BEFORE the second occurrence (within 6000 chars), else nearest "<label"
$window = 6000
$scanStart = [Math]::Max(0, $idx2 - $window)
$chunk = $jsx.Substring($scanStart, $idx2 - $scanStart)

$startRel = $chunk.LastIndexOf("<div", [System.StringComparison]::OrdinalIgnoreCase)
if ($startRel -lt 0) { $startRel = $chunk.LastIndexOf("<label", [System.StringComparison]::OrdinalIgnoreCase) }
if ($startRel -lt 0) { throw "Could not locate a safe start tag (<div or <label) before the 2nd Town block." }

$cutStart = $scanStart + $startRel

# End = "<button" for Create account AFTER idx2 (keep button intact). If not found, end at "</form>".
$btnText = ">Create account<"
$btnTextIdx = $jsx.IndexOf($btnText, $idx2, [System.StringComparison]::OrdinalIgnoreCase)

if ($btnTextIdx -ge 0) {
  $btnTagIdx = $jsx.LastIndexOf("<button", $btnTextIdx, [System.StringComparison]::OrdinalIgnoreCase)
  if ($btnTagIdx -lt 0) { throw "Found Create account text but could not locate <button tag for it." }
  $cutEnd = $btnTagIdx
} else {
  $formEnd = $jsx.IndexOf("</form>", $idx2, [System.StringComparison]::OrdinalIgnoreCase)
  if ($formEnd -lt 0) { throw "Could not locate Create account button or </form> after 2nd Town block." }
  $cutEnd = $formEnd
}

if ($cutEnd -le $cutStart) { throw "Invalid cut range inside JSX ($cutStart..$cutEnd)." }

$jsx2 = $jsx.Substring(0, $cutStart) + "`r`n" + $jsx.Substring($cutEnd)

# Optional: mark the remaining dropdown label required (visual only)
$jsx2 = $jsx2 -replace 'Town of origin\s*\(optional\)', 'Town of origin *'

$src2 = $before + $jsx2 + $after

if ($src2 -eq $orig) { throw "No changes applied after restore (unexpected)." }

Write-Utf8NoBom $target $src2
Write-Host "[OK] Dedup applied safely inside JSX return block."
Write-Host "== DONE =="