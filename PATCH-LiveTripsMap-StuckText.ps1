$ErrorActionPreference = "Stop"

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"

if (!(Test-Path $file)) {
  throw "LiveTripsMap.tsx not found at expected path"
}

# Backup
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $root ("backups\LiveTripsMap_STUCK_TEXT_FIX_" + $stamp + ".tsx")
Copy-Item $file $bak -Force
Write-Host "[OK] Backup created: $bak" -ForegroundColor Green

$txt = Get-Content $file -Raw -Encoding UTF8

# Normalize Unicode punctuation to ASCII
$txt = $txt.Replace("–", "-")
$txt = $txt.Replace("—", "-")
$txt = $txt.Replace("…", "...")

# Write back UTF-8 (NO BOM)
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($file, $txt, $utf8)

Write-Host "[OK] Stuck watcher text normalized to ASCII." -ForegroundColor Green
Write-Host ""
Write-Host "NEXT:" -ForegroundColor Cyan
Write-Host "1) Ctrl+C (stop dev server)"
Write-Host "2) Remove-Item .next -Recurse -Force"
Write-Host "3) npm run dev"
Write-Host "4) Ctrl+Shift+R (hard refresh)"
