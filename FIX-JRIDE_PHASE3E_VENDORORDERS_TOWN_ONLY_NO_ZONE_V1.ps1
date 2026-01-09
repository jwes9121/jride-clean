# FIX-JRIDE_PHASE3E_VENDORORDERS_TOWN_ONLY_NO_ZONE_V1.ps1
# PHASE 3E hotfix: bookings has column 'town' only. Remove 'zone' from vendor-orders create payload.
# Backup before patch. UTF-8 no BOM.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m){ throw $m }

function BackupFile($p){
  if(!(Test-Path -LiteralPath $p)){ Fail "Missing file: $p" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$p.bak.$ts"
  Copy-Item -LiteralPath $p -Destination $bak -Force
  Ok "Backup: $bak"
}

function ReadText($p){
  return [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
}

function WriteUtf8NoBom($p, $txt){
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $txt, $enc)
}

$path = "app\api\vendor-orders\route.ts"
Info "Target: $path"
BackupFile $path

$txt = ReadText $path

# We previously inserted a block like:
#   // PHASE_3E_VENDORORDERS_TOWNZONE_FIELDS
#   town: ...
#   zone: ...
# We will replace that block with town only.

$marker = "PHASE_3E_VENDORORDERS_TOWNZONE_FIELDS"
$idx = $txt.IndexOf($marker)

if($idx -lt 0){
  Warn "Marker '$marker' not found. Trying a direct removal of a 'zone:' line near the marker-less insert."
  # conservative: remove ONLY a line that starts with optional spaces then zone: deriveZoneFromTown(
  $lines = $txt -split "`r?`n"
  $out = New-Object System.Collections.Generic.List[string]
  $removed = 0
  foreach($ln in $lines){
    if($removed -eq 0 -and ($ln -match "^\s*zone\s*:\s*deriveZoneFromTown\(")){
      $removed++
      continue
    }
    $out.Add($ln)
  }
  if($removed -eq 0){
    Fail "Could not locate the inserted zone line to remove. Paste the createPayload section around town/zone."
  }
  $txt = ($out -join "`r`n")
  Ok "Removed one 'zone:' payload line."
}else{
  # Replace block from the comment line through the next 2 property lines (town+zone).
  $re = New-Object System.Text.RegularExpressions.Regex("(?ms)^\s*//\s*PHASE_3E_VENDORORDERS_TOWNZONE_FIELDS\s*\r?\n\s*town\s*:\s*.*?\r?\n\s*zone\s*:\s*.*?\r?\n")
  $before = $txt
  $replacement = @"
    // PHASE_3E_VENDORORDERS_TOWNZONE_FIELDS
    // bookings has 'town' column (no 'zone' column) — keep town only
    town: deriveTownFromLatLng(vendorLL.lat, vendorLL.lng),

"@
  $txt = $re.Replace($txt, $replacement)
  if($txt -eq $before){
    Fail "Found marker text but could not match expected town/zone block for replacement. Paste the lines around the marker."
  }
  Ok "Replaced town+zone payload block with town-only."
}

WriteUtf8NoBom $path $txt
Ok "Wrote: $path (UTF-8 no BOM)"

Write-Host ""
Write-Host "[NEXT] Run build:" -ForegroundColor Cyan
Write-Host "npm run build" -ForegroundColor White
