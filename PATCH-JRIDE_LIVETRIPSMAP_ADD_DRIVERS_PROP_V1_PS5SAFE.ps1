param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

function Ensure-Dir([string]$p){
  if(-not (Test-Path -LiteralPath $p)){ New-Item -ItemType Directory -Path $p | Out-Null }
}

function Read-TextUtf8NoBom([string]$path){
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF){
    $bytes = $bytes[3..($bytes.Length-1)]
  }
  return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Write-TextUtf8NoBom([string]$path, [string]$text){
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $enc)
}

if(-not (Test-Path -LiteralPath $ProjRoot)){ Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$target = Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx"
if(-not (Test-Path -LiteralPath $target)){ Fail "[FAIL] Missing: $target" }

$bakDir = Join-Path $ProjRoot "_patch_bak"
Ensure-Dir $bakDir
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("LiveTripsClient.tsx.bak.ADD_DRIVERS_PROP_V1.$stamp")
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "[OK] Backup: $bak"

$txt = Read-TextUtf8NoBom $target

# If already has drivers=, no-op
if($txt -match "(?s)<LiveTripsMap[^>]*\bdrivers\s*="){
  Ok "[OK] LiveTripsMap already has drivers prop. No changes."
  exit 0
}

# Replace the single-line call pattern (most common)
$pattern1 = "(?s)<LiveTripsMap\s+trips=\{[^}]*\}\s+selectedTripId=\{[^}]*\}\s+stuckTripIds=\{[^}]*\}\s*/>"
$replacement1 = @"
<LiveTripsMap
            trips={visibleTrips as any}
            selectedTripId={selectedTripId}
            stuckTripIds={stuckTripIds as any}
            drivers={drivers as any}
          />
"@

if($txt -match $pattern1){
  $newTxt = [System.Text.RegularExpressions.Regex]::Replace($txt, $pattern1, $replacement1, 1)
  Write-TextUtf8NoBom $target $newTxt
  Ok "[OK] Patched LiveTripsMap call to include drivers prop."
  Info "[NEXT] Run: npm.cmd run build"
  exit 0
}

# Fallback: inject drivers prop into any self-closing LiveTripsMap usage
$pattern2 = "(?s)(<LiveTripsMap\b[^>]*)(/>)"
if($txt -match $pattern2){
  $newTxt2 = [System.Text.RegularExpressions.Regex]::Replace(
    $txt,
    $pattern2,
    '$1 drivers={drivers as any} $2',
    1
  )
  Write-TextUtf8NoBom $target $newTxt2
  Ok "[OK] Injected drivers prop into LiveTripsMap usage (fallback)."
  Info "[NEXT] Run: npm.cmd run build"
  exit 0
}

Fail "[FAIL] Could not find LiveTripsMap usage to patch."