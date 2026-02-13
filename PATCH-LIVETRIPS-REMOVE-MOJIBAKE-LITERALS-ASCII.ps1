# PATCH-LIVETRIPS-REMOVE-MOJIBAKE-LITERALS-ASCII.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $root "app\admin\livetrips\components\TripLifecycleActions.tsx"
if (!(Test-Path $file)) { Fail "File not found: $file" }

$ts  = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$file.bak.$ts"
Copy-Item $file $bak -Force
Write-Host ("[OK] Backup: " + $bak) -ForegroundColor Green

$txt = Get-Content $file -Raw

# ASCII-only: look for double-quoted literals containing \u00C3 or \u00C2 characters
$C3 = [char]0x00C3  # Ã
$C2 = [char]0x00C2  # 

# Match "...." (single line) containing either char
$pattern = '(?m)"[^"\r\n]*[' + [regex]::Escape($C3 + $C2) + '][^"\r\n]*"'

$matches = [regex]::Matches($txt, $pattern).Count
if ($matches -eq 0) {
  Fail "No mojibake string literals found in TripLifecycleActions.tsx (no \\u00C3/\\u00C2 inside double-quoted strings)."
}

$txt2 = [regex]::Replace($txt, $pattern, '"N/A"')
Set-Content -Path $file -Value $txt2 -Encoding UTF8

Write-Host ("[OK] Replaced " + $matches + " mojibake literal(s) with ""N/A"".") -ForegroundColor Green
Write-Host "Next: npm run dev, then open /admin/livetrips and check Trip actions -> Code." -ForegroundColor Cyan
Write-Host "Rollback:" -ForegroundColor Yellow
Write-Host ("Copy-Item `"" + $bak + "`" `"" + $file + "`" -Force") -ForegroundColor Yellow
