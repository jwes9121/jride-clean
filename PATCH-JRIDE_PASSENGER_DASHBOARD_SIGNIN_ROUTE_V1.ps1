# PATCH-JRIDE_PASSENGER_DASHBOARD_SIGNIN_ROUTE_V1.ps1
# Rewrites passenger dashboard sign-in links away from /api/auth/signin to /passenger-login
# and adds a visible "Create account" CTA if possible.
# Safe backup. UTF-8 no BOM.

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

# 1) Replace any /api/auth/signin passenger redirects/links to /passenger-login
$txt2 = $txt -replace '"/api/auth/signin[^"]*"', '"/passenger-login"'
$txt2 = $txt2 -replace "window\.location\.href\s*=\s*`"/api/auth/signin[^`"]*`"", 'window.location.href = "/passenger-login"'

# 2) If there's a button label "Sign in to continue", ensure it navigates to /passenger-login
# (Handles href="/api/auth/signin" or onClick pushing it)
$txt2 = $txt2 -replace 'href=\{?"\/api\/auth\/signin[^"]*"?\}', 'href="/passenger-login"'

# 3) Try to add a "Create account" link near the sign-in button if marker exists
if ($txt2 -match 'Sign in to continue') {
  # very conservative: only add if the file contains Switch Account button (same section)
  if ($txt2 -match 'Switch Account') {
    $txt2 = [regex]::Replace(
      $txt2,
      '(Sign in to continue[\s\S]{0,300}Switch Account)',
      { param($m) $m.Value + "`n" + '<a className="ml-3 text-sm text-blue-600 underline" href="/passenger-signup">Create account</a>' },
      1
    )
  }
}

# Write UTF-8 no BOM
$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($f, $txt2, $enc)

Write-Host "[OK] Passenger dashboard sign-in now routes to /passenger-login (not Google)."
