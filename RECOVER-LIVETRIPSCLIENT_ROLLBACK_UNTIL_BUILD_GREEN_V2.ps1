# RECOVER-LIVETRIPSCLIENT_ROLLBACK_UNTIL_BUILD_GREEN_V2.ps1
# Restores app\admin\livetrips\LiveTripsClient.tsx from the newest .bak that makes npm build GREEN.
# HARD RULE: DO_NOT_TOUCH_DISPATCH_STATUS
# ASCII-only

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$uiFile = Join-Path $root 'app\admin\livetrips\LiveTripsClient.tsx'
if(!(Test-Path $uiFile)){ Fail ('UI file not found: ' + $uiFile) }

# Save current file (even if broken)
$pre = "$uiFile.pre_recover.$(Stamp)"
Copy-Item -LiteralPath $uiFile -Destination $pre -Force
Write-Host "[OK] Saved current file: $pre"

$dir = Split-Path $uiFile -Parent
$baks = Get-ChildItem -LiteralPath $dir -Filter 'LiveTripsClient.tsx.bak.*' -File |
  Sort-Object LastWriteTime -Descending

if(!$baks -or $baks.Count -lt 1){
  Fail "No backups found matching LiveTripsClient.tsx.bak.* in $dir"
}

Write-Host "[INFO] Found $($baks.Count) backups. Trying newest -> oldest until build passes..."

$used = $null

foreach($b in $baks){
  Write-Host ""
  Write-Host "[TRY] Restoring: $($b.FullName)"
  Copy-Item -LiteralPath $b.FullName -Destination $uiFile -Force

  Write-Host "[BUILD] npm.cmd run build"
  & npm.cmd run build
  if($LASTEXITCODE -eq 0){
    $used = $b.FullName
    Write-Host ""
    Write-Host "[GREEN] Build passed with backup:"
    Write-Host "        $used"
    break
  } else {
    Write-Host "[FAIL] Build failed with this backup. Trying previous..."
  }
}

if(-not $used){
  Copy-Item -LiteralPath $pre -Destination $uiFile -Force
  Fail "No backup produced a GREEN build. Restored the original pre_recover file."
}

# Save a restore point
$post = "$uiFile.recovered_green.$(Stamp)"
Copy-Item -LiteralPath $uiFile -Destination $post -Force
Write-Host "[OK] Saved recovered green copy: $post"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) Do NOT patch yet."
Write-Host "  2) Paste the [GREEN] backup path line here."
