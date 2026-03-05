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

Write-Host "== FIX JRIDE: passenger-signup select required syntax + safe required insert (V1 / PS5-safe) =="

$target = Join-Path $WebRoot "app\passenger-signup\page.tsx"
if (!(Test-Path -LiteralPath $target)) { throw "Target not found: $target" }

Backup $WebRoot $target "PASSENGER_SIGNUP_SELECT_REQUIRED_SYNTAX_V1"

$src  = Get-Content -LiteralPath $target -Raw -Encoding UTF8
$orig = $src

# 1) Repair the broken arrow token caused by wrong 'required' insertion:
#    onChange={(e) = required> setTownOrigin(...)}  -> onChange={(e) => setTownOrigin(...)}
$src = [regex]::Replace(
  $src,
  'onChange=\{\s*\(\s*e\s*\)\s*=\s*required>\s*setTownOrigin',
  'onChange={(e) => setTownOrigin',
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

# Also repair any other "= required>" occurrences inside onChange blocks (defensive)
$src = [regex]::Replace(
  $src,
  '\)\s*=\s*required>\s*',
  ') => ',
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

# 2) Ensure the townOrigin <select> opening tag has required=
# IMPORTANT: match the tag-close ">" that is followed by "<option", NOT the ">" in "=>"
$rxSelectCloseBeforeOption = '(?s)(<select\b[^>]*\bvalue=\{townOrigin\}[^>]*)(\>\s*\r?\n\s*<option)'
if ([regex]::IsMatch($src, $rxSelectCloseBeforeOption)) {
  $src = [regex]::Replace($src, $rxSelectCloseBeforeOption, {
    param($m)
    $head = $m.Groups[1].Value
    $tail = $m.Groups[2].Value
    if ($head -match '\srequired\b') { return $m.Value }
    return ($head + " required" + $tail)
  }, 1)
  Write-Host "[OK] Ensured townOrigin <select> is required (safe close before <option)."
} else {
  Write-Host "[WARN] Could not match townOrigin <select> close-before-<option. No required injected."
}

# Safety: must still contain Create account
if ($src -notmatch 'Create account') { throw "Safety abort: Create account not found after fix." }

if ($src -eq $orig) { throw "No changes applied. Aborting to avoid false green." }

Write-Utf8NoBom $target $src
Write-Host "[OK] Wrote: $target"
Write-Host "== DONE =="