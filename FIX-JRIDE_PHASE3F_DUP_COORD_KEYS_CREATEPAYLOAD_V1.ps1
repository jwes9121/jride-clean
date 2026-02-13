# FIX-JRIDE_PHASE3F_DUP_COORD_KEYS_CREATEPAYLOAD_V1.ps1
# Remove earlier duplicate coord keys in createPayload, keep Phase 3F injected keys.
# Targets: pickup_lat, pickup_lng, dropoff_lat, dropoff_lng
# UTF-8 no BOM, backup before patch.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Fail($m){ throw $m }

function WriteUtf8NoBom($p, $txt){
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $txt, $enc)
}
function BackupFile($p){
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$p.bak.$ts"
  Copy-Item -LiteralPath $p -Destination $bak -Force
  Ok "Backup: $bak"
  return $bak
}

$target = "app\api\vendor-orders\route.ts"
Info "Target: $target"
if(!(Test-Path -LiteralPath $target)){ Fail "Missing file: $target" }

$txt = [System.IO.File]::ReadAllText($target, [System.Text.Encoding]::UTF8)

$idxCreate = $txt.IndexOf("const createPayload")
if($idxCreate -lt 0){ Fail "Anchor not found: const createPayload" }

$idxPhase = $txt.IndexOf("// PHASE_3F create-time town + coords", $idxCreate)
if($idxPhase -lt 0){ Fail "Anchor not found: // PHASE_3F create-time town + coords" }

$pre  = $txt.Substring(0, $idxCreate)
$rest = $txt.Substring($idxCreate)

$beforePhase = $rest.Substring(0, $idxPhase - $idxCreate)
$afterPhase  = $rest.Substring($idxPhase - $idxCreate)

# Remove LAST occurrences of each key line in beforePhase (closest duplicates to Phase_3F)
$keys = @("pickup_lat","pickup_lng","dropoff_lat","dropoff_lng")

foreach($k in $keys){
  $rx = "(?m)^[ \t]*" + [Regex]::Escape($k) + "\s*:\s*[^,\r\n]+,\s*$"
  $ms = [System.Text.RegularExpressions.Regex]::Matches($beforePhase, $rx)
  if($ms.Count -ge 1){
    $last = $ms[$ms.Count - 1]
    $beforePhase = $beforePhase.Remove($last.Index, $last.Length)
    Ok "Removed earlier duplicate: $k"
  } else {
    Ok "No earlier $k found (ok)"
  }
}

$patched = $pre + $beforePhase + $afterPhase

BackupFile $target | Out-Null
WriteUtf8NoBom $target $patched
Ok "Removed earlier duplicate coord keys; kept Phase 3F keys."

Write-Host ""
Write-Host "[NEXT] Run build:" -ForegroundColor Cyan
Write-Host "npm run build" -ForegroundColor White
