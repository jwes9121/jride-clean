# PATCH-LIVETRIPS-REMOVE-MOJIBAKE-LITERALS.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $root "app\admin\livetrips\components\TripLifecycleActions.tsx"
if (!(Test-Path $file)) { Fail "File not found: $file" }

$ts  = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$file.bak.$ts"
Copy-Item $file $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $file -Raw

# Replace any double-quoted string literal containing mojibake markers Ã or  with "N/A"
# (display-only, safest possible fix)
$pattern = '"[^"\r\n]*[Ã][^"\r\n]*"'
$matches = [regex]::Matches($txt, $pattern).Count
if ($matches -eq 0) {
  Fail "No mojibake string literals found (no Ã/ inside double-quoted strings). Nothing to change."
}

$txt2 = [regex]::Replace($txt, $pattern, '"N/A"')
Set-Content -Path $file -Value $txt2 -Encoding UTF8

Write-Host "[OK] Replaced $matches mojibake literal(s) with `"N/A`" in TripLifecycleActions.tsx." -ForegroundColor Green
Write-Host "Next: npm run dev, open /admin/livetrips and check Trip actions -> Code." -ForegroundColor Cyan
Write-Host "Rollback: Copy-Item `"$bak`" `"$file`" -Force" -ForegroundColor Yellow
