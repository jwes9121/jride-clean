# PATCH-JRIDE_LIVETRIPS_FIX_ROWS_REF_V2_PS5SAFE.ps1
# PS5-safe: NO ternary, NO ??, NO tricky quoting inside regex strings.
# Fixes:
# - Any `${rows.length}` -> `${drivers.length}` inside LiveTripsClient.tsx
# - Fixes the glued pattern: `setDriversDebug(`...`);} catch (err: any) {` (adds newline + semicolon)
# - Also fixes the specific broken non-template debug: setDriversDebug(Drivers: loaded ...) -> setDriversDebug(`Drivers: loaded ...`);
#
# Usage:
# powershell -ExecutionPolicy Bypass -File .\PATCH-JRIDE_LIVETRIPS_FIX_ROWS_REF_V2_PS5SAFE.ps1 -ProjRoot "C:\path\to\repo"

param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail([string]$m){ Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }
function Info([string]$m){ Write-Host "[INFO] $m" -ForegroundColor DarkGray }
function Ok([string]$m){ Write-Host "[OK]  $m" -ForegroundColor Green }

function Backup-File([string]$path, [string]$tag){
  if(!(Test-Path -LiteralPath $path)){ Fail "Missing file: $path" }
  $bakDir = Join-Path $ProjRoot "_patch_bak"
  if(!(Test-Path -LiteralPath $bakDir)){ New-Item -ItemType Directory -Path $bakDir | Out-Null }
  $leaf = Split-Path -Leaf $path
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = Join-Path $bakDir ($leaf + ".bak." + $tag + "." + $ts)
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Ok ("Backup: " + $bak)
}

function Read-Text([string]$path){
  [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function Write-Text([string]$path, [string]$text){
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

if(!(Test-Path -LiteralPath $ProjRoot)){ Fail "ProjRoot not found: $ProjRoot" }

$clientPath = Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx"
if(!(Test-Path -LiteralPath $clientPath)){ Fail "Missing: $clientPath" }

Info "== PATCH: LiveTripsClient fix rows ref + glued catch (V2 / PS5-safe) =="
Info ("Repo: " + $ProjRoot)

$orig = Read-Text $clientPath
$txt  = $orig

# Trim BOM if present
$txt = $txt.TrimStart([char]0xFEFF)

$changed = $false

# --- A) Replace `${rows.length}` -> `${drivers.length}` ---
# (safe, simple string replace; not regex)
if($txt -like "*`${rows.length}*"){
  $txt = $txt.Replace('${rows.length}','${drivers.length}')
  $changed = $true
  Ok "Replaced `${rows.length}` -> `${drivers.length}`"
} else {
  Info "No `${rows.length}` found (ok)."
}

# --- B) Fix the exact glued sequence by a safe string approach ---
# Bad: setDriversDebug(`...`);} catch (err: any) {
# We will transform any occurrence of: ");} catch (err: any) {" directly AFTER setDriversDebug(...) call.
# We'll do a conservative regex that does NOT try to match backticks/quotes, only the suffix.

$reSuffix = New-Object System.Text.RegularExpressions.Regex(
  "setDriversDebug\(([\s\S]*?)\)\s*;\s*\}\s*catch\s*\(\s*err\s*:\s*any\s*\)\s*\{",
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)

if($reSuffix.IsMatch($txt)){
  $txt = $reSuffix.Replace($txt, "setDriversDebug(`$1);`r`n    } catch (err: any) {", 1)
  $changed = $true
  Ok "Fixed glued `} catch` formatting after setDriversDebug(...);"
} else {
  $reSuffix2 = New-Object System.Text.RegularExpressions.Regex(
    "setDriversDebug\(([\s\S]*?)\)\s*\}\s*catch\s*\(\s*err\s*:\s*any\s*\)\s*\{",
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  if($reSuffix2.IsMatch($txt)){
    $txt = $reSuffix2.Replace($txt, "setDriversDebug(`$1);`r`n    } catch (err: any) {", 1)
    $changed = $true
    Ok "Fixed glued `} catch` formatting (variant) after setDriversDebug(...)"
  } else {
    Info "No glued `} catch` pattern found (ok)."
  }
}

# --- C) Fix the specific broken line you showed:
# setDriversDebug(Drivers: loaded from /api/admin/driver_locations (${rows.length}));
# or without backticks/quotes (invalid TS) -> wrap in backticks and use drivers.length
$reBrokenDbg = New-Object System.Text.RegularExpressions.Regex(
  "setDriversDebug\(\s*Drivers:\s*loaded\s*from\s*/api/admin/driver_locations\s*\(\s*\$\{\s*(rows|drivers)\.length\s*\}\s*\)\s*\)\s*;",
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

if($reBrokenDbg.IsMatch($txt)){
  $txt = $reBrokenDbg.Replace($txt, "setDriversDebug(`"Drivers: loaded from /api/admin/driver_locations (${drivers.length})`");", 1)
  $changed = $true
  Ok "Fixed invalid TS debug string (wrapped in template literal, uses drivers.length)"
}

if(-not $changed){
  Fail "No changes applied. Open LiveTripsClient.tsx and search for 'setDriversDebug' and 'rows.length' then paste the 25 lines around it."
}

Backup-File $clientPath "LIVETRIPS_FIX_ROWS_REF_V2"
Write-Text $clientPath $txt
Ok ("Wrote: " + $clientPath)

Write-Host ""
Ok "NEXT:"
Write-Host "1) npm.cmd run build" -ForegroundColor Yellow
Write-Host "2) Refresh /admin/livetrips and confirm it compiles + drivers list/map loads" -ForegroundColor Yellow
Write-Host ""

Write-Host "POST-SCRIPT (git):" -ForegroundColor Yellow
Write-Host "git status" -ForegroundColor Yellow
Write-Host "git add -A" -ForegroundColor Yellow
Write-Host "git commit -m `"LiveTrips: fix rows ref + debug string`"" -ForegroundColor Yellow
Write-Host "git tag `"jride-livetrips-rows-ref-v2`"" -ForegroundColor Yellow
Write-Host "git push" -ForegroundColor Yellow
Write-Host "git push --tags" -ForegroundColor Yellow