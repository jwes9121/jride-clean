# FIX-JRIDE_PASSENGER_SIGNIN_URL_ENCODE_BUG_V3.ps1
# Fixes "/passenger-login%2Fpassenger" bug by removing "+ encodeURIComponent(...)" from passenger sign-in routing.
# Forces clean route: /passenger-login?next=%2Fpassenger
# UTF-8 no BOM + backup.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Backup($p){
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  Copy-Item $p "$p.bak.$ts" -Force
  Write-Host "[OK] Backup: $p.bak.$ts"
}

$root = (Get-Location).Path
$f = Join-Path $root "app\passenger\page.tsx"
if (!(Test-Path $f)) { Fail "Missing file: $f" }

Backup $f
$txt = Get-Content $f -Raw

# 1) Fix common bad pattern: "/passenger-login" + encodeURIComponent(...)
$txt = [regex]::Replace(
  $txt,
  '(["'']\/passenger-login["'']\s*\+\s*encodeURIComponent\s*\([^)]*\))',
  '"/passenger-login?next=%2Fpassenger"',
  0
)

# 2) Fix other concatenations: "/passenger-login" + <anything including encodeURIComponent>
$txt = [regex]::Replace(
  $txt,
  '(["'']\/passenger-login["'']\s*\+\s*[^;\r\n\)]*)',
  '"/passenger-login?next=%2Fpassenger"',
  0
)

# 3) If there’s still a literal "/passenger-login?callbackUrl=...." inside quotes, normalize it
$txt = [regex]::Replace(
  $txt,
  '["'']\/passenger-login\?callbackUrl=[^"'']*["'']',
  '"/passenger-login?next=%2Fpassenger"',
  0
)

# 4) If any window.location/router.push still points to /passenger-login without next, add next
$txt = $txt -replace 'window\.location\.href\s*=\s*["'']\/passenger-login["'']', 'window.location.href = "/passenger-login?next=%2Fpassenger"'
$txt = $txt -replace 'router\.push\(\s*["'']\/passenger-login["'']\s*\)', 'router.push("/passenger-login?next=%2Fpassenger")'

$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($f, $txt, $enc)

Write-Host "[OK] Fixed passenger sign-in routing to /passenger-login?next=%2Fpassenger"
Write-Host "[OK] File: $f"
