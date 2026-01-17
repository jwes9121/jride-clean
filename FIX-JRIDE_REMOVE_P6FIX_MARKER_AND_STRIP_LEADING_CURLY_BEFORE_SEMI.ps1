# FIX-JRIDE_REMOVE_P6FIX_MARKER_AND_STRIP_LEADING_CURLY_BEFORE_SEMI.ps1
# Fix: remove the marker line and strip ONLY the leading '}' from the next line when it is " } ... );"
# This resolves scanner mismatch:
#   Closing '}' at line ~668 but top of stack is '(' opened at return(
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

$marker = "P6FIX_MISSING_CURLY_BEFORE_ROW_CLOSE"
if($txt.IndexOf($marker) -lt 0){
  Fail "Marker not found: P6FIX_MISSING_CURLY_BEFORE_ROW_CLOSE"
}

$lines = $txt -split "`r?`n"

$done = $false
$out = New-Object System.Collections.Generic.List[string]

for($i=0; $i -lt $lines.Count; $i++){
  $line = $lines[$i]

  if(-not $done -and ($line -match $marker)){
    # 1) Skip marker line
    if(($i + 1) -ge $lines.Count){ Fail "Marker is last line; cannot patch." }

    # 2) Patch the immediate next line: must be like "   }    );"
    $next = $lines[$i + 1]

    # Require that line contains a leading '}' before a ');' close
    # Example: "            }                  );"
    $re = '^(?<ws>\s*)\}(?<mid>\s*)(?<rest>\);\s*)$'
    $m = [regex]::Match($next, $re)
    if(-not $m.Success){
      Fail "Marker found but next line is not of form: <ws>}<spaces>);  Refusing to patch."
    }

    # Replace next line by removing only that leading '}'
    $patchedNext = $m.Groups["ws"].Value + $m.Groups["mid"].Value + $m.Groups["rest"].Value

    # Write patched next line (skip the original next line)
    $out.Add($patchedNext) | Out-Null
    $i = $i + 1
    $done = $true
    continue
  }

  $out.Add($line) | Out-Null
}

if(-not $done){
  Fail "Marker was present but patch did not apply."
}

# Backup
$bak = "$file.bak.$(Stamp)"
Copy-Item -LiteralPath $file -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

Set-Content -LiteralPath $file -Value ($out -join "`r`n") -Encoding UTF8
Write-Host "[OK] Patched: $file"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) powershell -ExecutionPolicy Bypass -File .\DIAG-JRIDE_LIVETRIPSCLIENT_BRACE_PAREN_BALANCE_SCANNER.ps1"
Write-Host "  2) npm.cmd run build"
