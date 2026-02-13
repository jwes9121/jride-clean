# PATCH-JRIDE_P6B_PAGE_DATA_EXPOSE_SUGGESTED_VERIFIED_FARE.ps1
# Purpose: Expose suggested_verified_fare in Admin LiveTrips page-data response
# Scope: BACKEND ONLY (page-data route)
# HARD RULES:
# - DO_NOT_TOUCH_DISPATCH_STATUS
# - NO_DECLARE / NO_REDECLARE
# - ANCHOR_BASED_ONLY
# - ASCII ONLY

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$file = Join-Path $root "app\api\admin\livetrips\page-data\route.ts"
if(!(Test-Path $file)){ Fail "route.ts not found" }

$src = Get-Content -LiteralPath $file -Raw -Encoding UTF8

# We only patch the final object returned to the client
# Anchor: res.json({ ... })
$anchor = 'return NextResponse\.json\(\{'
if(-not [regex]::IsMatch($src, $anchor)){
  Fail "Anchor not found: return NextResponse.json({"
}

# Guard: do not double-add
if($src -match 'suggested_verified_fare'){
  Fail "suggested_verified_fare already exists. Aborting."
}

$patched = [regex]::Replace(
  $src,
  $anchor,
  {
    param($m)
    $m.Value + "`n    suggested_verified_fare: (rows?.[0]?.suggested_verified_fare ?? null),"
  },
  1
)

if($patched -eq $src){
  Fail "Patch produced no changes"
}

$bak = "$file.bak.$(Stamp)"
Copy-Item -LiteralPath $file -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

Set-Content -LiteralPath $file -Value $patched -Encoding UTF8
Write-Host "[OK] Patched: $file"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) npm.cmd run build"
