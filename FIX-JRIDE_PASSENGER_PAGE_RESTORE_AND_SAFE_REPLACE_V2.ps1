# FIX-JRIDE_PASSENGER_PAGE_RESTORE_AND_SAFE_REPLACE_V2.ps1
# Restores app/passenger/page.tsx from the latest .bak.* then applies a safe string replace:
# "/api/auth/signin..." => "/passenger-login"
# No JSX injection. UTF-8 no BOM.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

$root = (Get-Location).Path
$dir = Join-Path $root "app\passenger"
$f   = Join-Path $dir  "page.tsx"

if (!(Test-Path $f)) { Fail "Missing file: $f" }

# Find latest backup
$bak = Get-ChildItem -Path $dir -Filter "page.tsx.bak.*" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (!$bak) { Fail "No backup found (page.tsx.bak.*) in $dir" }

Copy-Item $bak.FullName $f -Force
Write-Host "[OK] Restored from backup: $($bak.Name)"

$txt = Get-Content $f -Raw

# Safe replacements (no regex injection into JSX blocks)
# Replace any string literal occurrences of /api/auth/signin... inside quotes
$txt2 = $txt -replace '"/api/auth/signin[^"]*"', '"/passenger-login"'
$txt2 = $txt2 -replace "'/api/auth/signin[^']*'", "'/passenger-login'"

# Replace window.location.href = "/api/auth/signin..."
$txt2 = $txt2 -replace 'window\.location\.href\s*=\s*"/api/auth/signin[^"]*"', 'window.location.href = "/passenger-login"'
$txt2 = $txt2 -replace "window\.location\.href\s*=\s*'/api/auth/signin[^']*'", "window.location.href = '/passenger-login'"

# Replace router.push("/api/auth/signin...")
$txt2 = $txt2 -replace 'router\.push\(\s*"/api/auth/signin[^"]*"\s*\)', 'router.push("/passenger-login")'
$txt2 = $txt2 -replace "router\.push\(\s*'/api/auth/signin[^']*'\s*\)", "router.push('/passenger-login')"

$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($f, $txt2, $enc)

Write-Host "[OK] Applied safe signin route replace (no JSX injection)."
Write-Host "[OK] File: $f"
