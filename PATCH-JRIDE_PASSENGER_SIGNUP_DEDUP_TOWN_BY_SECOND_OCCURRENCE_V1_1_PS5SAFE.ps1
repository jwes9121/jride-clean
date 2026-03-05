param(
  [Parameter(Mandatory=$true)][string]$WebRoot
)

$ErrorActionPreference="Stop"
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

function Write-Utf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function Backup([string]$path, [string]$tag) {
  $bakDir = Join-Path $WebRoot "_patch_bak"
  New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
  $leaf = Split-Path $path -Leaf
  $bak = Join-Path $bakDir ("$leaf.bak.$tag.$ts")
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

Write-Host "== PATCH JRIDE: Passenger Signup remove duplicate Town section (2nd occurrence cut) V1.1 / PS5-safe =="

if (!(Test-Path -LiteralPath $WebRoot)) { throw "WebRoot not found: $WebRoot" }

$targetRel = "app\passenger-signup\page.tsx"
$target = Join-Path $WebRoot $targetRel
if (!(Test-Path -LiteralPath $target)) { throw "Target not found: $target" }

Backup $target "PASSENGER_SIGNUP_DEDUP_TOWN_V1_1"
Write-Host "[OK] Target: $target"

$src  = Get-Content -LiteralPath $target -Raw -Encoding UTF8
$orig = $src

# ---- Remove duplicate Town section by removing everything from the 2nd "Town of origin" to the Create account button ----
$needle = "Town of origin"

$idx1 = $src.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase)
if ($idx1 -lt 0) { throw "Could not find first occurrence of '$needle' in page.tsx" }

$idx2 = $src.IndexOf($needle, $idx1 + $needle.Length, [System.StringComparison]::OrdinalIgnoreCase)
if ($idx2 -lt 0) {
  throw "Could not find second occurrence of '$needle'. If the UI still shows two towns, then the duplicate text differs."
}

# Find the Create account button AFTER the second occurrence
# We match by button text to keep it stable.
$btnNeedle = ">Create account<"
$btnIdx = $src.IndexOf($btnNeedle, $idx2, [System.StringComparison]::OrdinalIgnoreCase)
if ($btnIdx -lt 0) {
  # fallback: just locate "<button" after idx2
  $btnNeedle2 = "<button"
  $btnIdx = $src.IndexOf($btnNeedle2, $idx2, [System.StringComparison]::OrdinalIgnoreCase)
  if ($btnIdx -lt 0) { throw "Could not locate Create account button after the second Town section." }
}

# We remove from a safe start: the opening tag of the label container that contains the second Town occurrence.
# Walk backwards from idx2 to nearest '<' on the same/previous line.
$cutStart = $idx2
for ($i = $idx2; $i -ge 0; $i--) {
  if ($src[$i] -eq '<') { $cutStart = $i; break }
  # stop at huge distance? no, keep scanning
}

# Remove up to just before the Create account button block begins (keep button intact)
$cutEnd = $btnIdx

if ($cutEnd -le $cutStart) { throw "Computed invalid cut range ($cutStart..$cutEnd)." }

$src = $src.Substring(0, $cutStart) + "`r`n" + $src.Substring($cutEnd)

Write-Host "[OK] Removed duplicate Town section chunk (2nd '$needle' -> Create account button)."

# ---- OPTIONAL: Make dropdown Town required if it is still marked optional ----
# This does NOT delete the dropdown; it enforces required where possible.
$src = $src -replace 'Town of origin\s*\(optional\)', 'Town of origin *'

# Add required to the first <select ...> that likely corresponds to town dropdown (best-effort)
if ($src -match '<select[^>]*>' -and $src -notmatch '<select[^>]*\srequired') {
  $src = [regex]::Replace($src, '(<select\b(?![^>]*\srequired)[^>]*)(>)', '$1 required$2', 1)
  Write-Host "[OK] Added required to first <select> (best-effort for town dropdown)."
} else {
  Write-Host "[WARN] Did not inject required into <select> (already required or not matched)."
}

if ($src -eq $orig) { throw "No changes applied. Aborting to avoid false green." }

Write-Utf8NoBom $target $src
Write-Host "[OK] Wrote: $target"
Write-Host "== DONE =="