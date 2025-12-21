$ErrorActionPreference = "Stop"

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"

if (!(Test-Path $file)) {
  throw "LiveTripsClient.tsx not found"
}

# Backup
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $root "backups\LiveTripsClient_RENDER_SAFE_$stamp.tsx"
Copy-Item $file $bak -Force
Write-Host "[OK] Backup created:" $bak -ForegroundColor Green

$txt = Get-Content $file -Raw -Encoding UTF8

# Insert helper AFTER "use client";
if ($txt -notmatch "function safeText") {
  $helper = @"
function safeText(v: any) {
  if (v == null) return "-";
  const s = String(v);
  return s.replace(/[^\x00-\x7F]/g, "-");
}

"@
  $txt = $txt -replace '"use client";', '"use client";' + "`n`n" + $helper
  Write-Host "[OK] safeText helper inserted" -ForegroundColor Green
} else {
  Write-Host "[OK] safeText already exists" -ForegroundColor Green
}

# VERY IMPORTANT:
# We DO NOT regex JSX.
# We only replace direct variable outputs if present.

$txt = $txt.Replace("{trip.passenger_name}", "{safeText(trip.passenger_name)}")
$txt = $txt.Replace("{trip.town}", "{safeText(trip.town)}")
$txt = $txt.Replace("{trip.zone_name_resolved}", "{safeText(trip.zone_name_resolved)}")

# Write back UTF-8 (NO BOM)
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($file, $txt, $utf8)

Write-Host "[OK] LiveTripsClient render sanitization applied" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT:" -ForegroundColor Cyan
Write-Host "1) Ctrl+C (stop dev server)"
Write-Host "2) Remove-Item .next -Recurse -Force"
Write-Host "3) npm run dev"
Write-Host "4) Ctrl+Shift+R in browser"
