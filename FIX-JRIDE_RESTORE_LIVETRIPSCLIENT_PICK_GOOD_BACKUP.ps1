# FIX-JRIDE_RESTORE_LIVETRIPSCLIENT_PICK_GOOD_BACKUP.ps1
# Restores LiveTripsClient.tsx from the best pre-P6D backup (auto-detected).
# HARD RULES: ANCHOR_BASED_ONLY, FAIL FAST, DO_NOT_TOUCH_DISPATCH_STATUS

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$dir  = Join-Path $root 'app\admin\livetrips'
$target = Join-Path $dir 'LiveTripsClient.tsx'

if(!(Test-Path $target)){ Fail "Target not found: $target" }

$backs = Get-ChildItem -LiteralPath $dir -Filter 'LiveTripsClient.tsx.bak.*' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending

if(-not $backs -or $backs.Count -eq 0){
  Fail "No backups found in: $dir (expected LiveTripsClient.tsx.bak.*)"
}

function LooksGood($path){
  try {
    $t = Get-Content -LiteralPath $path -Raw -Encoding UTF8
    if($t.IndexOf('export default function LiveTripsClient()') -lt 0){ return $false }
    if($t.IndexOf('return (') -lt 0){ return $false }
    # must be pre-P6D
    if($t.IndexOf('P6D: guarded draft helpers') -ge 0){ return $false }
    # must be P6C-green baseline (has draft)
    if($t.IndexOf('P6C: UI-only proposed fare draft') -lt 0){ return $false }
    return $true
  } catch {
    return $false
  }
}

$pick = $null
foreach($b in $backs){
  if(LooksGood $b.FullName){
    $pick = $b
    break
  }
}

if(-not $pick){
  # fallback: accept any backup that at least has LiveTripsClient + return, even if missing P6C marker
  foreach($b in $backs){
    try{
      $t = Get-Content -LiteralPath $b.FullName -Raw -Encoding UTF8
      if($t.IndexOf('export default function LiveTripsClient()') -ge 0 -and $t.IndexOf('return (') -ge 0 -and $t.IndexOf('P6D: guarded draft helpers') -lt 0){
        $pick = $b
        break
      }
    } catch {}
  }
}

if(-not $pick){
  Fail "Could not find a usable pre-P6D backup automatically. (Backups exist but none match expected anchors.)"
}

# Make a safety backup of CURRENT broken file before overwrite
$curBak = "$target.bak.$(Stamp).broken_saved"
Copy-Item -LiteralPath $target -Destination $curBak -Force
Write-Host "[OK] Saved current broken file as: $curBak"

# Restore chosen backup
Copy-Item -LiteralPath $pick.FullName -Destination $target -Force
Write-Host "[OK] Restored LiveTripsClient.tsx from: $($pick.FullName)"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) npm.cmd run build"
