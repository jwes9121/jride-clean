# FIX-JRIDE_PHASE7A_MINUTESSINCEISO_TO_MINUTESSINCE.ps1
# Fix compile error in LiveTripsClient.tsx:
# minutesSinceIso is not defined; file uses minutesSince().
#
# Patch: replace minutesSinceIso( -> minutesSince(
# Touches ONLY: app\admin\livetrips\LiveTripsClient.tsx

$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }

function Backup($p){
  if(!(Test-Path -LiteralPath $p)){ Fail "Missing file: $p" }
  $bak = "$p.bak.$(Stamp)"
  Copy-Item -LiteralPath $p -Destination $bak -Force
  Write-Host "[OK] Backup $bak"
}

function ReadRaw($p){ Get-Content -LiteralPath $p -Raw }

function WriteUtf8NoBom($p,$c){
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $c, $enc)
  Write-Host "[OK] Wrote $p"
}

$P = "app\admin\livetrips\LiveTripsClient.tsx"
Backup $P

$txt = ReadRaw $P

if ($txt -notmatch "minutesSinceIso\(") {
  Write-Host "[OK] No minutesSinceIso() calls found. Nothing to do."
  exit 0
}

$txt2 = $txt -replace "minutesSinceIso\(", "minutesSince("

WriteUtf8NoBom $P $txt2
Write-Host "[DONE] Replaced minutesSinceIso() calls with minutesSince()."
