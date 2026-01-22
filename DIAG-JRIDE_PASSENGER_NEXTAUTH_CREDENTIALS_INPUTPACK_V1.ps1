# DIAG-JRIDE_PASSENGER_NEXTAUTH_CREDENTIALS_INPUTPACK_V1.ps1
# Collect the minimum files needed to implement NextAuth Credentials for Passenger auth.
# Creates _upload_nextauth_credentials_pack\ with copies you can upload here.

$ErrorActionPreference = "Stop"

function Ensure-Dir($p) { if (!(Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null } }
function Copy-IfExists($src, $dstDir) {
  if (Test-Path $src) {
    Copy-Item $src -Destination $dstDir -Force
    Write-Host "[OK] Copied: $src"
    return $true
  } else {
    Write-Host "[MISS] Not found: $src"
    return $false
  }
}

$root = (Get-Location).Path
$outDir = Join-Path $root "_upload_nextauth_credentials_pack"
Ensure-Dir $outDir

Write-Host "== Repo root: $root =="
Write-Host "== Output:   $outDir =="
Write-Host ""

# 1) NextAuth config + handler
$authTs = Join-Path $root "auth.ts"
$nextauthRoute = Join-Path $root "app\api\auth\[...nextauth]\route.ts"
$middlewareTs = Join-Path $root "middleware.ts"

Copy-IfExists $authTs $outDir | Out-Null
Copy-IfExists $nextauthRoute $outDir | Out-Null
Copy-IfExists $middlewareTs $outDir | Out-Null

# 2) Passenger dashboard + passenger login/signup pages (in case we need to adjust sign-in button/flow)
$passengerPage = Join-Path $root "app\passenger\page.tsx"
$passengerLogin = Join-Path $root "app\passenger-login\page.tsx"
$passengerSignup = Join-Path $root "app\passenger-signup\page.tsx"

Copy-IfExists $passengerPage $outDir | Out-Null
Copy-IfExists $passengerLogin $outDir | Out-Null
Copy-IfExists $passengerSignup $outDir | Out-Null

# 3) Your existing custom auth routes (these define the real login rules we must mirror inside Credentials.authorize)
$loginRoute = Join-Path $root "app\api\public\auth\login\route.ts"
$signupRoute = Join-Path $root "app\api\public\auth\signup\route.ts"

Copy-IfExists $loginRoute $outDir | Out-Null
Copy-IfExists $signupRoute $outDir | Out-Null

# 4) Any “me/session” route (optional, only if exists)
$meRoute = Join-Path $root "app\api\public\auth\me\route.ts"
Copy-IfExists $meRoute $outDir | Out-Null

Write-Host ""
Write-Host "== DONE =="
Write-Host "Upload the contents of: $outDir"
Write-Host ""
Write-Host "Tip: Zip it (optional):"
Write-Host "  Compress-Archive -Path `"$outDir\*`" -DestinationPath `"$root\nextauth_credentials_pack.zip`" -Force"
