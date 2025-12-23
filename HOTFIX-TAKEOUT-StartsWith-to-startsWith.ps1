# C:\Users\jwes9\Desktop\jride-clean-fresh\HOTFIX-TAKEOUT-StartsWith-to-startsWith.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$repo = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$target = Join-Path $repo "app\admin\livetrips\LiveTripsClient.tsx"

if (!(Test-Path $repo)) { Fail "Repo root not found: $repo" }
if (!(Test-Path $target)) { Fail "Target file not found: $target" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup created:`n  $bak" -ForegroundColor Green

$txt = Get-Content $target -Raw

# Replace JS-invalid StartsWith with correct startsWith
$beforeCount = ([regex]::Matches($txt, "\.StartsWith\s*\(")).Count
if ($beforeCount -eq 0) {
  Fail "No '.StartsWith(' found in LiveTripsClient.tsx. Nothing to patch."
}

$txt2 = [regex]::Replace($txt, "\.StartsWith\s*\(", ".startsWith(")

Set-Content -Path $target -Value $txt2 -Encoding UTF8

$after = Get-Content $target -Raw
$afterCount = ([regex]::Matches($after, "\.StartsWith\s*\(")).Count
if ($afterCount -ne 0) { Fail "Patch failed: '.StartsWith(' still present." }

Write-Host "[OK] Replaced $beforeCount occurrence(s) of '.StartsWith(' with '.startsWith('." -ForegroundColor Green
Write-Host "[DONE] Hotfix applied:`n  $target" -ForegroundColor Green
