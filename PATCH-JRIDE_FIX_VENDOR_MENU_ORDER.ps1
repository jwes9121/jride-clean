# PATCH-JRIDE_FIX_VENDOR_MENU_ORDER.ps1
# Fix vendor_menu_today ordering (remove non-existent created_at column)
# UTF-8 no BOM, backup included

$ErrorActionPreference = "Stop"
$root = Get-Location
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$api = Join-Path $root "app\api\vendor-menu\route.ts"
if (!(Test-Path $api)) { throw "Missing file: $api" }

Copy-Item $api "$api.bak.$ts"

$txt = Get-Content -Raw -Encoding UTF8 $api

# Replace invalid order clause
$txt = $txt -replace `
  '\.order\("sort_order",\s*\{\s*ascending:\s*true\s*\}\)\s*\.order\("created_at",\s*\{\s*ascending:\s*true\s*\}\)',
  '.order("sort_order", { ascending: true }).order("name", { ascending: true })'

[System.IO.File]::WriteAllText($api, $txt, $utf8NoBom)

Write-Host "[OK] Fixed vendor_menu ordering"
