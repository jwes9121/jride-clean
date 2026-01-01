# FIX-JRIDE_LIVETRIPSCLIENT_REWRAP_COMPONENT.ps1
# Rewraps JSX return inside LiveTripsClient component
# This is a structural repair, not a feature change

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Backup($p){
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  Copy-Item $p "$p.bak.$ts" -Force
  Write-Host "[OK] Backup: $p.bak.$ts" -ForegroundColor Green
}
function Read($p){
  $t = Get-Content $p -Raw -Encoding UTF8
  if($t.Length -gt 0 -and [int]$t[0] -eq 0xFEFF){ $t = $t.Substring(1) }
  return $t
}
function Write($p,$t){
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p,$t,$utf8NoBom)
}

$path = "app\admin\livetrips\LiveTripsClient.tsx"
if(!(Test-Path $path)){ Fail "Missing $path" }
Backup $path

$txt = Read $path

# 1) Locate component start
$compMatch = [regex]::Match($txt, 'export\s+default\s+function\s+LiveTripsClient\s*\([^)]*\)\s*\{')
if(-not $compMatch.Success){
  Fail "Could not find 'export default function LiveTripsClient(...) {'"
}

$compStart = $compMatch.Index + $compMatch.Length

# 2) Locate JSX return block
$retMatch = [regex]::Match($txt, '(?s)\n\s*return\s*\(\s*<div[\s\S]*?\n\s*\);\s*')
if(-not $retMatch.Success){
  Fail "Could not locate JSX return block"
}

$returnBlock = $retMatch.Value

# 3) Remove JSX return from current location
$txt = $txt.Remove($retMatch.Index, $retMatch.Length)

# 4) Ensure component body contains the return
$txt = $txt.Insert($compStart, "`r`n" + $returnBlock + "`r`n")

# 5) Ensure component is properly closed
if ($txt -notmatch "export\s+default\s+function\s+LiveTripsClient[\s\S]*?\}\s*$") {
  $txt += "`r`n}"
}

Write $path $txt
Write-Host "[OK] Rewrapped JSX return inside LiveTripsClient component." -ForegroundColor Green
