# FIX-JRIDE_PHASE3D_VENDORORDERS_HELPERS_SCOPE_V16.ps1
# Fix helpers accidentally placed inside toNum().
# Moves PHASE_3D helpers to module scope.
# Backup before patch. UTF-8 no BOM.

$ErrorActionPreference="Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$path = "app\api\vendor-orders\route.ts"
if(!(Test-Path $path)){ Fail "Missing $path" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $path "$path.bak.$ts" -Force
Ok "Backup created: $path.bak.$ts"

$txt = Get-Content $path -Raw

$start = $txt.IndexOf("// PHASE_3D_TAKEOUT_COORDS_HELPERS")
$end   = $txt.IndexOf("// PHASE_3D_TAKEOUT_COORDS_HELPERS_END")

if($start -lt 0 -or $end -lt 0){
  Fail "Helpers block not found"
}

$end += "// PHASE_3D_TAKEOUT_COORDS_HELPERS_END".Length

$helpers = $txt.Substring($start, $end - $start)
$txt = $txt.Remove($start, $end - $start)

# Close toNum() immediately after opening
$toNumIdx = $txt.IndexOf("function toNum")
if($toNumIdx -lt 0){ Fail "toNum() not found" }

$braceIdx = $txt.IndexOf("{", $toNumIdx)
$insertClose = $txt.IndexOf("const n = Number", $braceIdx)

$txt =
  $txt.Substring(0, $insertClose) +
  "  const n = Number(v ?? 0);\r\n  return Number.isFinite(n) ? n : 0;\r\n}\r\n\r\n" +
  $txt.Substring($insertClose)

# Insert helpers at module scope (after imports)
$lastImport = [regex]::Matches($txt, "(?m)^import .*?;$") | Select-Object -Last 1
if(!$lastImport){ Fail "No import lines found" }

$pos = $lastImport.Index + $lastImport.Length
$txt = $txt.Insert($pos, "`r`n`r`n$helpers`r`n")

$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $txt, $utf8)

Ok "Helpers moved to module scope successfully"
