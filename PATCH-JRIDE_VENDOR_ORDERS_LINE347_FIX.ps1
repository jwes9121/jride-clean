# PATCH-JRIDE_VENDOR_ORDERS_LINE347_FIX.ps1
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

$target = "app\vendor-orders\page.tsx"
if(!(Test-Path $target)){ Fail "Missing file: $target" }

$lines = Get-Content $target

$lineNum = 347
if($lineNum -lt 1 -or $lineNum -gt $lines.Count){ Fail "Line $lineNum out of range (1..$($lines.Count))" }

$lines[$lineNum-1] = '            Permission: <span className="font-semibold">{vGeoPermission}</span> | Inside Ifugao: <span className="font-semibold">{String(vGeoInsideIfugao)}</span> | Last: {vGeoLast ? `${vGeoLast.lat.toFixed(5)},${vGeoLast.lng.toFixed(5)}` : "n/a"}'

# Write UTF-8 NO BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllBytes((Resolve-Path $target), $utf8NoBom.GetBytes(($lines -join "`r`n")))

Write-Host "[OK] Patched line 347 (use vGeoInsideIfugao) + wrote UTF-8 no BOM" -ForegroundColor Green
