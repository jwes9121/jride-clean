param(
  [Parameter(Mandatory=$true)][string]$WebRoot
)

$ErrorActionPreference="Stop"
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

function Write-Utf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function Backup([string]$root, [string]$path, [string]$tag) {
  $bakDir = Join-Path $root "_patch_bak"
  New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
  $leaf = Split-Path $path -Leaf
  $bak = Join-Path $bakDir ("$leaf.bak.$tag.$ts")
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

Write-Host "== PATCH JRIDE: passenger-signup remove JRIDE_TOWN_ORIGIN_UI_V1 block + require dropdown (V1 / PS5-safe) =="

$target = Join-Path $WebRoot "app\passenger-signup\page.tsx"
if (!(Test-Path -LiteralPath $target)) { throw "Target not found: $target" }

Backup $WebRoot $target "PASSENGER_SIGNUP_REMOVE_INJECTED_TOWN_BLOCK_V1"

$src  = Get-Content -LiteralPath $target -Raw -Encoding UTF8
$orig = $src

# Safety: ensure we are working on the correct file and it still has the submit button
if ($src -notmatch 'Create account') { throw "Safety abort: Create account button not found in file before patch." }

# 1) Remove the injected block: from the comment anchor up to the next <button (submit)
$anchor = "JRIDE_TOWN_ORIGIN_UI_V1"
$ai = $src.IndexOf($anchor, [System.StringComparison]::Ordinal)
if ($ai -lt 0) {
  Write-Host "[OK] Injected block anchor not found. Skipping removal."
} else {
  # Find the start of the comment token "<!--" not applicable; it's JSX comment "{/* ... */}"
  # We'll remove from the "{/* JRIDE_TOWN_ORIGIN_UI_V1 */}" line (or nearest "{/*" before anchor)
  $start = $src.LastIndexOf("{/*", $ai, [System.StringComparison]::Ordinal)
  if ($start -lt 0) { $start = $ai } # fallback, still safe due to anchor uniqueness

  # End at the next "<button" AFTER the anchor (keep button)
  $btn = $src.IndexOf("<button", $ai, [System.StringComparison]::OrdinalIgnoreCase)
  if ($btn -lt 0) { throw "Could not locate <button after injected town block. Aborting." }

  if ($btn -le $start) { throw "Invalid removal range for injected block." }

  $src = $src.Substring(0, $start) + "`r`n" + $src.Substring($btn)
  Write-Host "[OK] Removed injected JRIDE_TOWN_ORIGIN_UI_V1 block."
}

# 2) Make the dropdown town label not say optional + add required on the <select> for townOrigin
# Label text tweak
$src = [regex]::Replace(
  $src,
  '(<label[^>]*>\s*Town of origin)\s*\(optional\)(\s*</label>)',
  '$1 *$2',
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

# Also handle label without closing tag on same line (your file uses plain text inside label)
$src = [regex]::Replace(
  $src,
  '(Town of origin)\s*\(optional\)',
  '$1 *',
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

# Option text tweak
$src = [regex]::Replace(
  $src,
  '(Select town)\s*\(optional\)',
  '$1',
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

# Add required to the select that is bound to value={townOrigin}
$rxSelectTown = '(?s)(<select\b[^>]*\bvalue=\{townOrigin\}[^>]*)(>)'
if ([regex]::IsMatch($src, $rxSelectTown)) {
  $src = [regex]::Replace($src, $rxSelectTown, {
    param($m)
    $head = $m.Groups[1].Value
    $tail = $m.Groups[2].Value
    if ($head -match '\srequired\b') { return $m.Value }
    return ($head + " required" + $tail)
  }, 1)
  Write-Host "[OK] Ensured townOrigin <select> is required."
} else {
  Write-Host "[WARN] Could not match townOrigin <select> by value={townOrigin}. No required attr added."
}

# Final safety: Create account must remain
if ($src -notmatch 'Create account') { throw "Safety abort: Create account missing after patch." }

if ($src -eq $orig) { throw "No changes applied (unexpected). Aborting." }

Write-Utf8NoBom $target $src
Write-Host "[OK] Wrote: $target"
Write-Host "== DONE =="