# FIX-JRIDE_LIVETRIPS_RESTORE_MAP_CLOSE_TO_PAREN_STYLE.ps1
# Fix: restore the visibleTrips.map close tail from:
#   );
#   }}
# to:
#   );
#   })}
# right before the "{visibleTrips.length === 0 ? (" block.
# This resolves scanner mismatch: Closing '}' with EMPTY stack near line ~668.
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

# Anchor: we only patch the exact tail right before the empty-state conditional
$pat = '(?s)(</tr>\s*\r?\n\s*\);\s*\r?\n\s*)\}\}\s*(\r?\n\s*\r?\n\s*\{visibleTrips\.length\s*===\s*0\s*\?\s*\()'
if(-not [regex]::IsMatch($txt, $pat)){
  Fail "Target pattern not found: expected '</tr> ... ); ... }}' immediately before '{visibleTrips.length === 0 ? ('"
}

$txt2 = [regex]::Replace($txt, $pat, '$1})}$2', 1)
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
