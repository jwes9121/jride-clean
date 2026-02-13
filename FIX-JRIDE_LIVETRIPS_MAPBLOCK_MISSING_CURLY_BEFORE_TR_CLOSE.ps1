# FIX-JRIDE_LIVETRIPS_MAPBLOCK_MISSING_CURLY_BEFORE_TR_CLOSE.ps1
# Fix: Insert ONE missing '}' inside visibleTrips.map row renderer right before the ');' line.
# This targets scanner mismatch: closing ')' but top-of-stack is '{' opened earlier.
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

# Anchors from your scanner context:
# ... </tr>
#     );
#     })}   (or variations)
# {visibleTrips.length === 0 ? (
if($txt.IndexOf("visibleTrips.length") -lt 0){ Fail "Anchor not found: visibleTrips.length" }
if($txt.IndexOf("</tr>") -lt 0){ Fail "Anchor not found: </tr>" }

# Prevent double-apply: if we already inserted our marker, abort
if($txt.IndexOf("P6FIX_MISSING_CURLY_BEFORE_ROW_CLOSE") -ge 0){
  Fail "Fix marker already present. Aborting."
}

# Target pattern: closing of a row return immediately followed by the map close and then visibleTrips.length empty-state block
# We inject one '}' line BEFORE the ');' line.
$re = '(?s)(</tr>\s*\r?\n)(\s*\);\s*\r?\n\s*\}\)\}\s*\r?\n\s*\r?\n\s*\{visibleTrips\.length\s*===\s*0\s*\?\s*\()'

$m = [regex]::Match($txt, $re)
if(-not $m.Success){
  # Slightly more permissive fallback (handles "})}" vs "}) }" etc.)
  $re2 = '(?s)(</tr>\s*\r?\n)(\s*\);\s*\r?\n\s*\}\)\}\s*\r?\n\s*\{visibleTrips\.length\s*===\s*0\s*\?\s*\()'
  $m = [regex]::Match($txt, $re2)
}

if(-not $m.Success){
  Fail "Could not find the row-close pattern near the visibleTrips map end. Not patching."
}

$before = $m.Groups[1].Value
$after  = $m.Groups[2].Value

# Inject missing } before the ');'
$inject = @"
$before            // P6FIX_MISSING_CURLY_BEFORE_ROW_CLOSE
            }
"@

# Rebuild the matched region: </tr>\n + injected + rest (starting with ');\n ...')
$replacement = $inject + $after

$txt2 = $txt.Substring(0, $m.Index) + $replacement + $txt.Substring($m.Index + $m.Length)

if($txt2 -eq $txt){
  Fail "Patch produced no changes. Not patching."
}

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
