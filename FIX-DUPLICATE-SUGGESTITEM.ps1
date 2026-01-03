# FIX-DUPLICATE-SUGGESTITEM.ps1
# One file only: app\ride\page.tsx
# Removes the older duplicate "type SuggestItem =" block and keeps the newer union.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$path = Join-Path (Get-Location) "app\ride\page.tsx"
if (!(Test-Path $path)) { Fail "File not found: $path" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$stamp"
Copy-Item $path $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -Raw -Encoding UTF8 $path

# Old block pattern (no LocalSuggest):
# type SuggestItem =
#   | { kind: "geocode"; f: GeoFeature }
#   | SearchboxSuggest;
$patOld = '(?s)\btype\s+SuggestItem\s*=\s*\|\s*\{\s*kind:\s*"geocode";\s*f:\s*GeoFeature\s*\}\s*\|\s*SearchboxSuggest\s*;\s*'

$matches = [regex]::Matches($txt, $patOld)
if ($matches.Count -lt 1) {
  Fail "Could not find the old SuggestItem block (no LocalSuggest). Paste the top ~120 lines of app\ride\page.tsx."
}

# Remove ONLY the first old block occurrence.
$txt2 = [regex]::Replace($txt, $patOld, "", 1)

# Sanity: ensure we still have exactly one SuggestItem definition
$patAny = '\btype\s+SuggestItem\s*='
$any = [regex]::Matches($txt2, $patAny).Count
if ($any -ne 1) {
  Fail ("After removal, expected exactly 1 SuggestItem definition, found: " + $any + ". Paste the top ~140 lines of app\ride\page.tsx.")
}

Set-Content -Path $path -Value $txt2 -Encoding UTF8
Ok "Removed old duplicate SuggestItem block. Kept the LocalSuggest-enabled one."
