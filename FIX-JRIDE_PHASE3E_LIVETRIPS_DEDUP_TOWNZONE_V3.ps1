# FIX-JRIDE_PHASE3E_LIVETRIPS_DEDUP_TOWNZONE_V3.ps1
# Removes the injected duplicate town/zone block that caused "multiple properties with same name".
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

$path = "app\api\admin\livetrips\page-data\route.ts"
Info "Target: $path"
BackupFile $path

$txt = ReadText $path

# Remove the injected fallback block (marker + the following town/zone lines).
# We only remove the PHASE_3E_LIVETRIPS_TOWNZONE_FALLBACK block we inserted.
$re = New-Object System.Text.RegularExpressions.Regex("(?ms)^\s*//\s*PHASE_3E_LIVETRIPS_TOWNZONE_FALLBACK.*?\r?\n\s*town\s*:\s*.*?\r?\n\s*zone\s*:\s*.*?\r?\n(\s*\r?\n)?")
$before = $txt
$txt = $re.Replace($txt, "")

if($txt -eq $before){
  Warn "No PHASE_3E_LIVETRIPS_TOWNZONE_FALLBACK block found. Nothing changed."
} else {
  Ok "Removed duplicate injected town/zone fallback block."
}

WriteUtf8NoBom $path $txt
Ok "Wrote: $path (UTF-8 no BOM)"

Ok "Next: npm run build"
