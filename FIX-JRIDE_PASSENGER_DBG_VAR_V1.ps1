# FIX-JRIDE_PASSENGER_DBG_VAR_V1.ps1
# Fixes "Cannot find name 'dbg'" by defining a dbg const right before return().
# Backup + UTF-8 no BOM.

$ErrorActionPreference="Stop"
function Fail($m){ throw $m }
function Backup($p){
  $ts=Get-Date -Format "yyyyMMdd_HHmmss"
  Copy-Item $p "$p.bak.$ts" -Force
  Write-Host "[OK] Backup: $p.bak.$ts"
}

$root=(Get-Location).Path
$f=Join-Path $root "app\passenger\page.tsx"
if(!(Test-Path $f)){ Fail "Missing file: $f" }

Backup $f
$txt=Get-Content $f -Raw

# If dbg already defined, do nothing
if($txt -match '\bconst\s+dbg\s*='){
  Write-Host "[SKIP] dbg already defined."
} else {
  # Insert "const dbg = ..." just before the first "return ("
  $pattern = '(?s)\n\s*return\s*\('
  if(-not [regex]::IsMatch($txt,$pattern)){ Fail "Could not find 'return (' anchor in app/passenger/page.tsx" }

  $insert = @'
  const dbg = {
    note: "TEMP DEBUG",
    time: new Date().toISOString(),
  };

'@

  $txt = [regex]::Replace($txt, $pattern, "`n$insert`n  return (", 1)
  Write-Host "[OK] Inserted dbg const before return()."
}

$enc=New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($f,$txt,$enc)
Write-Host "[OK] Patched: $f"
