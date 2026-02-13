# FIX-JRIDE_VERIFICATION_UPLOADERR_BLOCK_REMOVE_V1.ps1
# Removes the injected uploadErr JSX block to fix "Cannot find name 'uploadErr'".
# ASCII only, UTF-8 no BOM, backup included.

$ErrorActionPreference = "Stop"

function NowStamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function ReadU($p){ [IO.File]::ReadAllText($p, [Text.UTF8Encoding]::new($false)) }
function WriteU($p,$t){ [IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($false)) }

$root = Get-Location
$stamp = NowStamp
$f = Join-Path $root "app\verification\page.tsx"
if(!(Test-Path $f)){ throw "Missing: $f" }

Copy-Item $f "$f.bak.$stamp" -Force
$txt = ReadU $f

# Remove the exact injected block (multiline, non-greedy)
$pattern = '(?ms)\s*\{uploadErr\s*\?\s*\(\s*<div className="text-sm text-red-600">Upload error:\s*\{uploadErr\}<\/div>\s*\)\s*:\s*null\s*\}\s*'
$txt2 = [regex]::Replace($txt, $pattern, "`r`n")

if($txt2 -eq $txt){
  Write-Host "[WARN] uploadErr block not found with exact pattern. Trying a looser match..."
  $pattern2 = '(?ms)\s*\{uploadErr\s*\?\s*\(.*?Upload error:.*?\)\s*:\s*null\s*\}\s*'
  $txt2 = [regex]::Replace($txt, $pattern2, "`r`n")
}

WriteU $f $txt2
Write-Host "[OK] Removed uploadErr JSX block."
Write-Host "[OK] Backup: $f.bak.$stamp"
