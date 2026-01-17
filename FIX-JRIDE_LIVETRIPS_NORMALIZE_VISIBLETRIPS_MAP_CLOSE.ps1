# FIX-JRIDE_LIVETRIPS_NORMALIZE_VISIBLETRIPS_MAP_CLOSE.ps1
# Normalizes the visibleTrips.map row renderer closing sequence to:
#   </tr>
#   );
#   })}
# This fixes scanner error: closing ')' with EMPTY stack near line ~668.
# HARD RULES: ANCHOR_BASED_ONLY, NO_DECLARE, NO_REDECLARE_NO_DECLARE, DO_NOT_TOUCH_DISPATCH_STATUS
# ASCII-only

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$file = Join-Path $root 'app\admin\livetrips\LiveTripsClient.tsx'
if(!(Test-Path $file)){ Fail ("File not found: " + $file) }

$txt = Get-Content -LiteralPath $file -Raw -Encoding UTF8

# Anchors
if($txt.IndexOf("visibleTrips.length") -lt 0){ Fail "Anchor not found: visibleTrips.length" }
if($txt.IndexOf("</tr>") -lt 0){ Fail "Anchor not found: </tr>" }

# Match the exact tail just before the empty-state block
# We expect:
#   </tr>
#   );
#   ...some close line...
#   {visibleTrips.length === 0 ? (
$re = '(?s)(</tr>\s*\r?\n)(?<ind1>\s*)\);\s*\r?\n(?<ind2>\s*)(?<close>\}\)\}|\}\}\}|\)\}\}|\}\)\)\}|\)\)\}|\}\}\)\}|\}\)\}\))\s*\r?\n\s*\r?\n(?=\s*\{visibleTrips\.length\s*===\s*0\s*\?\s*\()'
$m = [regex]::Match($txt, $re)

if(-not $m.Success){
  # Fallback: looser match (still anchored to the empty-state block)
  $re2 = '(?s)(</tr>\s*\r?\n)(?<ind1>\s*)\);\s*\r?\n(?<ind2>\s*).{0,40}\r?\n\s*\r?\n(?=\s*\{visibleTrips\.length\s*===\s*0\s*\?\s*\()'
  $m = [regex]::Match($txt, $re2)
}

if(-not $m.Success){
  Fail "Could not locate the map-close tail before the empty-state block. Not patching."
}

$before = $m.Groups[1].Value
$ind1   = $m.Groups["ind1"].Value
$ind2   = $m.Groups["ind2"].Value

$replacement = $before + $ind1 + ");`r`n" + $ind2 + "})}`r`n`r`n"

# Backup
$bak = "$file.bak.$(Stamp)"
Copy-Item -LiteralPath $file -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt2 = $txt.Substring(0, $m.Index) + $replacement + $txt.Substring($m.Index + $m.Length)
Set-Content -LiteralPath $file -Value $txt2 -Encoding UTF8
Write-Host "[OK] Patched: $file"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) powershell -ExecutionPolicy Bypass -File .\DIAG-JRIDE_LIVETRIPSCLIENT_BRACE_PAREN_BALANCE_SCANNER.ps1"
Write-Host "  2) npm.cmd run build"
