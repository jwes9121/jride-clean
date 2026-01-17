# FIX-JRIDE_LIVETRIPS_TAIL_SWAP_DOUBLEPAREN_TO_CURLY_PAREN.ps1
# Fix: Change the tail close line from:
#   ))}
# to:
#   })}
# right before the empty-state block "{visibleTrips.length === 0 ? ("
#
# Scanner says: closing ')' but top of stack is '{' -> need '}' before ')'
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

if($txt.IndexOf("{visibleTrips.length === 0 ?") -lt 0){
  Fail "Anchor not found: {visibleTrips.length === 0 ?"
}

# Target ONLY:
# </tr>
#    ))}
#
# {visibleTrips.length === 0 ? (
$pat = '(?s)(</tr>\s*\r?\n)(?<ws>\s*)\)\)\}\s*\r?\n\s*\r?\n(?=\s*\{visibleTrips\.length\s*===\s*0\s*\?\s*\()'
$m = [regex]::Match($txt, $pat)
if(-not $m.Success){
  Fail "Target pattern not found: expected '</tr>' then '))}' immediately before '{visibleTrips.length === 0 ? ('."
}

$ws = $m.Groups["ws"].Value
$replacement = $m.Groups[1].Value + $ws + "})}`r`n`r`n"

# Backup
$bak = "$file.bak.$(Stamp)"
Copy-Item -LiteralPath $file -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt2 = $txt.Substring(0, $m.Index) + $replacement + $txt.Substring($m.Index + $m.Length)
if($txt2 -eq $txt){ Fail "Patch produced no changes. Aborting." }

Set-Content -LiteralPath $file -Value $txt2 -Encoding UTF8
Write-Host "[OK] Patched: $file"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) powershell -ExecutionPolicy Bypass -File .\DIAG-JRIDE_LIVETRIPSCLIENT_BRACE_PAREN_BALANCE_SCANNER.ps1"
Write-Host "  2) npm.cmd run build"
