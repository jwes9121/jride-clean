# FIX-JRIDE_P7C_P4PICKUPDISTANCE_REMOVE_P4NUM_DEP_V1.ps1
# ASCII-only. Anchor-based by index slicing. UTF8 NO BOM. UI-only passenger. NO_MOJIBAKE.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Timestamp(){ (Get-Date).ToString("yyyyMMdd_HHmmss") }

function ReadText($path){
  if(!(Test-Path -LiteralPath $path)){ Fail "Missing file: $path" }
  [System.IO.File]::ReadAllText($path)
}
function WriteUtf8NoBom($path,$text){
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path,$text,$enc)
}

$root = (Get-Location).Path
$target = Join-Path $root "app\ride\page.tsx"
if(!(Test-Path -LiteralPath $target)){ Fail "Target not found: $target. Run from repo root." }

$ts = Timestamp
$bak = "$target.bak.$ts"
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = ReadText $target
$orig = $txt

# Locate p4PickupDistanceFee start
$start = $txt.IndexOf("function p4PickupDistanceFee")
if($start -lt 0){ Fail "ANCHOR NOT FOUND: function p4PickupDistanceFee not found." }

# End boundary: next "function " after pickup fee
$end = $txt.IndexOf("function ", $start + 1)
if($end -lt 0){ Fail "ANCHOR NOT FOUND: could not find end boundary after p4PickupDistanceFee." }

$fn = @'
// Pickup Distance Fee rule (FINAL):
// Free pickup: up to 1.5 km
// If driver->pickup distance > 1.5 km:
// Base pickup fee: PHP 20
// PHP 10 per additional 0.5 km, rounded up
function p4PickupDistanceFee(driverToPickupKmAny: any): number {
  const km0 = (typeof driverToPickupKmAny === "number") ? driverToPickupKmAny : Number(driverToPickupKmAny);
  const km = Number.isFinite(km0) ? km0 : null;

  if (km == null) return 0;
  if (km <= 1.5) return 0;

  const base = 20;
  const perHalfKm = 10;

  const over = km - 1.5;
  const steps = Math.ceil(over / 0.5);

  return base + steps * perHalfKm;
}

'@

$before = $txt.Substring(0, $start)
$after  = $txt.Substring($end)
$txt = $before + $fn + $after

# Safe mojibake cleanup tokens (in case any exist elsewhere)
$txt = $txt.Replace("Ã¢â‚¬â€", "--")
$txt = $txt.Replace("Ã¢â€šÂ±", "PHP ")
$txt = $txt.Replace("â€¦", "...")

if($txt -eq $orig){
  Fail "No changes made (unexpected). Aborting without write."
}

WriteUtf8NoBom $target $txt
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
