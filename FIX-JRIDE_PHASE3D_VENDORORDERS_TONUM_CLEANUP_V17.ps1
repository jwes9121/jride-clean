# FIX-JRIDE_PHASE3D_VENDORORDERS_TONUM_CLEANUP_V17.ps1
# Cleans corrupted toNum() function containing literal \r\n text.
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

# Locate toNum() function
$re = [regex]::new("function\s+toNum\s*\(\s*v\s*:\s*any\s*\)\s*:\s*number\s*\{.*?\n\}", [System.Text.RegularExpressions.RegexOptions]::Singleline)
$m = $re.Match($txt)
if(!$m.Success){ Fail "toNum() function not found or malformed" }

$cleanToNum = @"
function toNum(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
"@

$txt = $txt.Remove($m.Index, $m.Length).Insert($m.Index, $cleanToNum)

# Remove any stray literal \r\n sequences left behind
$txt = $txt -replace "\\r\\n", ""

$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $txt, $utf8)

Ok "Cleaned toNum() and removed literal \\r\\n text"
