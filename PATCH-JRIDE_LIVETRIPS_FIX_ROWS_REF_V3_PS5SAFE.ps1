# PATCH-JRIDE_LIVETRIPS_FIX_ROWS_REF_V3_PS5SAFE.ps1
# PS5-safe: avoids `${...}` in PowerShell patterns, avoids backtick quoting issues, avoids ternary/??.
# Fixes LiveTripsClient.tsx after broken patches:
# - Replace any '${rows.length}' -> '${drivers.length}'
# - Fix invalid TS debug call: setDriversDebug(Drivers: loaded ...) -> setDriversDebug(`Drivers: loaded ...`);
# - Fix glued '} catch' formatting after setDriversDebug(...) blocks

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

Info "== PATCH: LiveTripsClient fix rows ref + debug string + glued catch (V3 / PS5-safe) =="
Info ("Repo: " + $ProjRoot)

$orig = Read-Text $clientPath
$txt  = $orig

# Remove UTF-8 BOM if present
$txt = $txt.TrimStart([char]0xFEFF)

$changed = $false

# --- A) Replace literal '${rows.length}' -> '${drivers.length}' safely ---
if($txt.IndexOf('${rows.length}') -ge 0){
  $txt = $txt.Replace('${rows.length}','${drivers.length}')
  $changed = $true
  Ok "Replaced literal ${rows.length} -> ${drivers.length}"
} else {
  Info "No literal ${rows.length} found (ok)."
}

# --- B) Fix invalid TS debug string that lost quotes/backticks ---
# Example broken line:
# setDriversDebug(Drivers: loaded from /api/admin/driver_locations (${rows.length}));
# or:
# setDriversDebug(Drivers: loaded from /api/admin/driver_locations (${drivers.length}));
$reBrokenDbg = New-Object System.Text.RegularExpressions.Regex(@'
setDriversDebug\(\s*Drivers:\s*loaded\s*from\s*/api/admin/driver_locations\s*\(\s*\$\{\s*(rows|drivers)\.length\s*\}\s*\)\s*\)\s*;
'@, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)

if($reBrokenDbg.IsMatch($txt)){
  # Replace with a valid TS template literal, always using drivers.length
  $txt = $reBrokenDbg.Replace($txt, 'setDriversDebug(`"Drivers: loaded from /api/admin/driver_locations (${drivers.length})`");', 1)
  $changed = $true
  Ok "Fixed broken setDriversDebug(...) line into a valid template literal (drivers.length)"
} else {
  Info "No broken unquoted setDriversDebug(Drivers: ...) found (ok)."
}

# --- C) Fix glued '} catch' formatting after setDriversDebug(...) ---
# We target patterns like:
# setDriversDebug(`"...`");} catch (err: any) {
# OR
# setDriversDebug("...");} catch (err: any) {
$reGlued = New-Object System.Text.RegularExpressions.Regex(@'
(setDriversDebug\([\s\S]*?\)\s*;)\s*\}\s*catch\s*\(\s*err\s*:\s*any\s*\)\s*\{
'@, [System.Text.RegularExpressions.RegexOptions]::Singleline)

if($reGlued.IsMatch($txt)){
  $txt = $reGlued.Replace($txt, '$1' + "`r`n" + '    } catch (err: any) {', 1)
  $changed = $true
  Ok "Fixed glued '} catch (err: any) {' after setDriversDebug(...);"
} else {
  Info "No glued '} catch' after setDriversDebug found (ok)."
}

if($txt -eq $orig){
  Fail "No changes applied by V3. Paste the 40 lines around your loadDrivers() block (the broken part) so we patch the exact region."
}

Backup-File $clientPath "LIVETRIPS_FIX_ROWS_REF_V3"
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
Write-Host "git tag `"jride-livetrips-rows-ref-v3`"" -ForegroundColor Yellow
Write-Host "git push" -ForegroundColor Yellow
Write-Host "git push --tags" -ForegroundColor Yellow