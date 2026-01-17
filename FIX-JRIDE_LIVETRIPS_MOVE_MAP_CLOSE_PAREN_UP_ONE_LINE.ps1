# FIX-JRIDE_LIVETRIPS_MOVE_MAP_CLOSE_PAREN_UP_ONE_LINE.ps1
# Fix: Move the map-closing ')' from the "})}" line up to the prior line.
# Converts:
#   );
#   })}
# Into:
#   ));
#   }}
# This resolves:
#   [MISMATCH] Closing ')' with EMPTY stack near the map close tail
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

# Anchor: must be right before the empty-state block
if($txt.IndexOf("{visibleTrips.length === 0 ?") -lt 0){
  Fail "Anchor not found: {visibleTrips.length === 0 ?"
}

# Target the exact tail:
# </tr>
#    );
#    })}
# <blank>
# {visibleTrips.length === 0 ? (
$pat = '(?s)(</tr>\s*\r?\n)(?<ws1>\s*)\);\s*\r?\n(?<ws2>\s*)\}\)\}\s*(\r?\n\s*\r?\n\s*\{visibleTrips\.length\s*===\s*0\s*\?\s*\()'
if(-not [regex]::IsMatch($txt, $pat)){
  Fail "Target pattern not found: expected '</tr> ... ); ... })}' immediately before '{visibleTrips.length === 0 ? ('"
}

$txt2 = [regex]::Replace(
  $txt,
  $pat,
  '${1}${ws1}));' + "`r`n" + '${ws2}}}' + '$4',
  1
)

if($txt2 -eq $txt){ Fail "Replace produced no changes. Aborting." }

# Backup
$bak = "$file.bak.$(Stamp)"
Copy-Item -LiteralPath $file -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

Set-Content -LiteralPath $file -Value $txt2 -Encoding UTF8
Write-Host "[OK] Patched: $file"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) powershell -ExecutionPolicy Bypass -File .\DIAG-JRIDE_LIVETRIPSCLIENT_BRACE_PAREN_BALANCE_SCANNER.ps1"
Write-Host "  2) npm.cmd run build"
