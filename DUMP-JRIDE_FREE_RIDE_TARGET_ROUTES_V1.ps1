# DUMP-JRIDE_FREE_RIDE_TARGET_ROUTES_V1.ps1
# Prints the key routes to console for quick copy/paste.
# ASCII only. Read-only.

$ErrorActionPreference="Stop"
$root = Get-Location

$targets = @(
  "app\api\public\passenger\book\route.ts",
  "app\api\dispatch\status\route.ts",
  "app\passenger\page.tsx"
)

foreach($rel in $targets){
  $p = Join-Path $root $rel
  Write-Host ""
  Write-Host "============================================================"
  Write-Host $rel
  Write-Host "------------------------------------------------------------"
  if(!(Test-Path $p)){
    Write-Host "MISSING: $p"
    continue
  }
  Get-Content -LiteralPath $p
}
