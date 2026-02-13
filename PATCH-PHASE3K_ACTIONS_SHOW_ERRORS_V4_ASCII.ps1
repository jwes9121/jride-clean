# PATCH-PHASE3K_ACTIONS_SHOW_ERRORS_V4_ASCII.ps1
# Wrap assignDriver() + updateTripStatus() so UI never "does nothing"
# Touch ONLY: app\admin\livetrips\LiveTripsClient.tsx
# ASCII-only script. UTF-8 no BOM output. Timestamped .bak.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$bak = "$target.bak.$(Stamp)"
Copy-Item $target $bak -Force
Write-Host ("[OK] Backup: " + $bak)

$lines = Get-Content $target

function Get-FunctionRange {
  param([string]$funcName)

  $start = -1
  for ($i=0; $i -lt $lines.Count; $i++){
    if ($lines[$i] -match ("^\s*async\s+function\s+" + [regex]::Escape($funcName) + "\s*\(")) { $start = $i; break }
  }
  if ($start -lt 0) { return $null }

  $open = -1
  for ($i=$start; $i -lt [Math]::Min($lines.Count, $start+30); $i++){
    if ($lines[$i].Contains("{")) { $open = $i; break }
  }
  if ($open -lt 0) { Fail ("Found " + $funcName + " but could not find opening brace") }

  $depth = 0
  $end = -1
  for ($i=$open; $i -lt $lines.Count; $i++){
    $line = $lines[$i]
    $depth += ([regex]::Matches($line, "\{").Count)
    $depth -= ([regex]::Matches($line, "\}").Count)
    if ($depth -eq 0) { $end = $i; break }
  }
  if ($end -lt 0) { Fail ("Could not find closing brace for " + $funcName) }

  return @{ Start=$start; Open=$open; End=$end }
}

function IndentOfLine([string]$s){
  if ($s -match '^(\s*)') { return $Matches[1] }
  return ""
}

function Replace-FunctionWithWrapped {
  param(
    [string]$funcName,
    [string]$doingText,
    [string]$failPrefix
  )

  $r = Get-FunctionRange -funcName $funcName
  if ($null -eq $r) { Fail ("Function not found: " + $funcName) }

  $start = $r.Start
  $open  = $r.Open
  $end   = $r.End

  $existing = ($lines[$start..$end] -join "`n")
  if ($existing -match [regex]::Escape($failPrefix + ":")) {
    Write-Host ("[OK] " + $funcName + " already wrapped - skipping")
    return
  }

  $indent = IndentOfLine $lines[$start]
  $indentIn = $indent + "  "

  $sig = @()
  for ($i=$start; $i -le $open; $i++){ $sig += $lines[$i] }

  $body = @()
  for ($i=($open+1); $i -le ($end-1); $i++){ $body += $lines[$i] }

  $new = @()
  $new += $sig
  $new += ($indentIn + 'try {')
  $new += ($indentIn + ('  setLastAction("' + $doingText + '");'))

  foreach ($b in $body){
    $new += ($indentIn + "  " + $b)
  }

  $new += ($indentIn + '} catch (err: any) {')
  $new += ($indentIn + ('  setLastAction("' + $failPrefix + ': " + String(err?.message || err));'))
  $new += ($indentIn + '  throw err;')
  $new += ($indentIn + '}')
  $new += ($indent + '}')

  $pre = @()
  if ($start -gt 0) { $pre = $lines[0..($start-1)] }

  $post = @()
  if ($end -lt ($lines.Count-1)) { $post = $lines[($end+1)..($lines.Count-1)] }

  $script:lines = @($pre + $new + $post)
  Write-Host ("[OK] Wrapped " + $funcName + " with try/catch and lastAction errors")
}

Replace-FunctionWithWrapped -funcName "assignDriver"     -doingText "Assigning..."       -failPrefix "Assign failed"
Replace-FunctionWithWrapped -funcName "updateTripStatus" -doingText "Updating status..." -failPrefix "Status update failed"

# Write UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($target, $lines, $utf8NoBom)

Write-Host ("[OK] Wrote: " + $target)
Write-Host "DONE: PHASE3K actions show errors (V4 ASCII)."
