# PATCH-DISPATCH-DRIVERS-ROUTE-REMOVE-DRIVER_NAME.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $root "app\api\dispatch\drivers\route.ts"
if (!(Test-Path $file)) { Fail "File not found: $file" }

$ts  = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$file.bak.$ts"
Copy-Item $file $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $file -Raw

# Replace the select(...) line to remove driver_name
$old = 'select("driver_id, driver_name, town, status, lat, lng, updated_at")'
$new = 'select("driver_id, town, status, lat, lng, updated_at")'
if ($txt -notmatch [regex]::Escape($old)) {
  Fail "Expected select(...) string not found. Paste the select line from $file."
}
$txt = $txt.Replace($old, $new)

# Remove mapping of name in the output object (safe if not present)
$txt = $txt -replace '(?m)^\s*name:\s*\(row as any\)\.driver_name\s*\?\?\s*null,\s*\r?\n', ''
# Also remove any lingering driver_name references
$txt = $txt -replace 'driver_name', '/* driver_name_removed */'

Set-Content -Path $file -Value $txt -Encoding UTF8
Write-Host "[OK] Patched /api/dispatch/drivers to not reference driver_name." -ForegroundColor Green

Write-Host ""
Write-Host "Retest:" -ForegroundColor Cyan
Write-Host "Invoke-RestMethod http://localhost:3000/api/dispatch/drivers" -ForegroundColor Cyan
Write-Host ""
Write-Host "Rollback:" -ForegroundColor Yellow
Write-Host ("Copy-Item `"" + $bak + "`" `"" + $file + "`" -Force") -ForegroundColor Yellow
