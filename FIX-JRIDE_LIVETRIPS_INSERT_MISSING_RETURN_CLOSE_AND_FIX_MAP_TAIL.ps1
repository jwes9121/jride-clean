# FIX-JRIDE_LIVETRIPS_INSERT_MISSING_RETURN_CLOSE_AND_FIX_MAP_TAIL.ps1
# Fix: After the row </tr>, ensure we close the row "return (" with ");
# then close the map callback + map call + JSX expression with "})}"
#
# Converts (right before empty-state <tr>):
#   </tr>
#   })
#   <tr>
# Into:
#   </tr>
#   );
#   })}
#   <tr>
#
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

# Anchor: must have a </tr> and a following empty-state <tr>
if($txt.IndexOf("</tr>") -lt 0){ Fail "Anchor not found: </tr>" }
if($txt.IndexOf("<tr>") -lt 0){ Fail "Anchor not found: <tr>" }

# Target ONLY the broken tail pattern immediately before an empty-state <tr>:
# </tr>
#    })
#    <tr>
#
# Capture indentation from the "})" line to reuse for inserted ");
$pat = '(?s)(</tr>\s*\r?\n)(?<ws>\s*)\}\)\s*\r?\n(?=\s*<tr>)'
$m = [regex]::Match($txt, $pat)
if(-not $m.Success){
  Fail "Target pattern not found: expected '</tr>' followed by a line containing '})' right before '<tr>'."
}

$ws = $m.Groups["ws"].Value

$replacement = $m.Groups[1].Value + $ws + ");`r`n" + $ws + "})}`r`n"

$txt2 = $txt.Substring(0, $m.Index) + $replacement + $txt.Substring($m.Index + $m.Length)
if($txt2 -eq $txt){ Fail "Patch produced no changes. Aborting." }

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
