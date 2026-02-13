# FIX-JRIDE_REMOVE_BAD_P6FIX_CURLY_ROBUST.ps1
# Removes the bad injected block:
#   // P6FIX_MISSING_CURLY_BEFORE_ROW_CLOSE
#   }
# which is breaking JSX parsing.
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
$idx = $txt.IndexOf($marker)
if($idx -lt 0){
  Fail "Marker not found. Nothing to remove."
}

# Split into lines for controlled removal
$lines = $txt -split "`r?`n"

$removed = $false
$out = New-Object System.Collections.Generic.List[string]

for($i = 0; $i -lt $lines.Count; $i++){
  $line = $lines[$i]

  if($line -match $marker){
    # Skip marker line
    $i++

    # Skip the next line ONLY if it contains just a closing curly
    if($i -lt $lines.Count){
      $next = $lines[$i].Trim()
      if($next -eq "}"){
        # Skip this line too
        $removed = $true
        continue
      } else {
        Fail "Marker found but next line is not a standalone '}'. Refusing to patch."
      }
    }
  }

  $out.Add($line) | Out-Null
}

if(-not $removed){
  Fail "Did not remove any injected curly. Aborting."
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
