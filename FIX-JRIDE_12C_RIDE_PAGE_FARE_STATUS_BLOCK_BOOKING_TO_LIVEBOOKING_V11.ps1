# FIX-JRIDE_12C_RIDE_PAGE_FARE_STATUS_BLOCK_BOOKING_TO_LIVEBOOKING_V11.ps1
# ASCII-only | UTF8 NO BOM
# Fixes TS scope error by rewriting ONLY the fare status JSX block:
# (booking as any) -> (liveBooking as any)

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function TS(){ (Get-Date).ToString("yyyyMMdd_HHmmss") }
function ReadT($p){ if(!(Test-Path -LiteralPath $p)){ Fail "Missing file: $p" }; [IO.File]::ReadAllText($p) }
function WriteUtf8NoBom($p,$t){ $enc = New-Object Text.UTF8Encoding($false); [IO.File]::WriteAllText($p,$t,$enc) }

$target = "app\ride\page.tsx"
if(!(Test-Path -LiteralPath $target)){ Fail "Target not found: $target" }

$bak = "$target.bak.$(TS)"
Copy-Item -Force $target $bak
Write-Host "[OK] Backup: $bak"

$txt = ReadT $target
$orig = $txt

# Match the exact fare status block
$rx = [regex]::new(
  '<div className="mt-2 text-sm">\s*<div>\s*Passenger response:\s*<span className="font-medium">\{\(booking as any\)\?\.(?:passenger_fare_response)\s*\?\?\s*"pending"\}</span>\s*</div>\s*\{\(booking as any\)\?\.(?:verified_fare)\s*!=\s*null\s*&&\s*\([\s\S]*?</div>',
  'Singleline'
)

$m = $rx.Match($txt)
if(-not $m.Success){
  Fail "ANCHOR NOT FOUND: Could not locate the fare status JSX block starting with <div className=`"mt-2 text-sm`">"
}

$block = $m.Value
$block2 = $block -replace '\(booking as any\)', '(liveBooking as any)'

if($block2 -eq $block){
  Fail "No changes inside matched block (unexpected)."
}

$txt = $txt.Substring(0,$m.Index) + $block2 + $txt.Substring($m.Index + $m.Length)

WriteUtf8NoBom $target $txt
Write-Host "[OK] Patched fare status block: booking -> liveBooking"
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
