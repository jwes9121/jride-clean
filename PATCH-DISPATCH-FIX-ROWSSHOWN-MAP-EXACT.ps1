# PATCH-DISPATCH-FIX-ROWSSHOWN-MAP-EXACT.ps1
# Fixes build by replacing rowsShown.map( with rowsForExport.map( (first occurrence).

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp { Get-Date -Format "yyyyMMdd-HHmmss" }

$path = "app\dispatch\page.tsx"
if (!(Test-Path $path)) { Fail "Missing file: $path" }

$bak = "$path.bak.$(Stamp)"
Copy-Item $path $bak -Force
Write-Host "OK Backup: $bak"

$txt  = [IO.File]::ReadAllText($path)
$orig = $txt

$idx = $txt.IndexOf("rowsShown.map(")
if ($idx -lt 0) {
  Fail "rowsShown.map( not found in page.tsx"
}

$txt = $txt.Substring(0, $idx) + "rowsForExport.map(" + $txt.Substring($idx + "rowsShown.map(".Length)

[IO.File]::WriteAllText($path, $txt)
Write-Host "DONE Replaced first rowsShown.map( with rowsForExport.map("
Write-Host "Next: npm.cmd run build"
