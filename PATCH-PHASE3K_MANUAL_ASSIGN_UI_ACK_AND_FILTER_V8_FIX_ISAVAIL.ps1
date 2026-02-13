# PATCH-PHASE3K_MANUAL_ASSIGN_UI_ACK_AND_FILTER_V8_FIX_ISAVAIL.ps1
# Fix build error: remove isAvail variable dependency in manual assign <option>
# Touches ONLY: app\admin\livetrips\LiveTripsClient.tsx
# UTF-8 no BOM + timestamped .bak

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$bak = "$target.bak.$(Stamp)"
Copy-Item $target $bak -Force
Write-Host ("[OK] Backup: " + $bak)

$txt = Get-Content $target -Raw

# Replace disabled={!isAvail} with inline availability check based on existing 'status' variable in the map block
if ($txt -notmatch 'disabled=\{\!isAvail\}') { Fail "Anchor not found: disabled={!isAvail}" }

$txt = $txt -replace 'disabled=\{\!isAvail\}', 'disabled={String(status || "").trim().toLowerCase() !== "available"}'

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt, $utf8NoBom)
Write-Host ("[OK] Wrote: " + $target)
Write-Host "DONE: Replaced disabled={!isAvail} with inline status check."
