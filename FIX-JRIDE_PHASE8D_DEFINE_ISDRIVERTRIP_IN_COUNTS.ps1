# FIX-JRIDE_PHASE8D_DEFINE_ISDRIVERTRIP_IN_COUNTS.ps1
# Fix: counts useMemo references isDriverTrip but it's out of scope.
# Patch: inject a local helper right before baseTrips in the counts block.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function BackupFile($p){
  if(!(Test-Path $p)){ Fail "Missing file: $p" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$p.bak.$ts"
  Copy-Item $p $bak -Force
  Write-Host "[OK] Backup: $bak" -ForegroundColor Green
}
function LoadUtf8($p){
  $t = Get-Content -LiteralPath $p -Raw -Encoding UTF8
  if($t.Length -gt 0 -and [int]$t[0] -eq 0xFEFF){ $t = $t.Substring(1) }
  return $t
}
function SaveUtf8NoBom($p,$t){
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $t, $utf8NoBom)
}

$client = "app\admin\livetrips\LiveTripsClient.tsx"
BackupFile $client

$txt = LoadUtf8 $client

$needle = 'const baseTrips = allTrips.filter(isDriverTrip);'

if ($txt -notmatch [regex]::Escape($needle)) {
  Fail "Could not find: $needle`nPaste the counts useMemo block if this happens."
}

$insert = @'
const isDriverTripLocal = (t: any) =>
      !!(t && (((t as any).driver_id ?? (t as any).assigned_driver_id ?? (t as any).driverId) != null));
    const baseTrips = allTrips.filter(isDriverTripLocal);
'@

# Replace ONLY the single line with the injected helper + updated baseTrips
$txt2 = $txt.Replace($needle, $insert)

SaveUtf8NoBom $client $txt2
Write-Host "[OK] Injected isDriverTripLocal into counts block." -ForegroundColor Green
Write-Host "[OK] Updated counts baseTrips filter to use isDriverTripLocal." -ForegroundColor Green
