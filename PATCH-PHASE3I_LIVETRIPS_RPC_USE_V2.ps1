# PATCH-PHASE3I_LIVETRIPS_RPC_USE_V2.ps1
# Switch LiveTrips API RPC from admin_get_live_trips_page_data() to admin_get_live_trips_page_data_v2()
# Creates a timestamped .bak, writes UTF-8 (no BOM), no partial edits.

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Ok($m) { Write-Host "[OK] $m" -ForegroundColor Green }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"

# Avoid Join-Path array issues; build absolute strings directly
$targets = @(
  "$root\app\api\admin\livetrips\page-data\route.ts",
  "$root\app\api\admin\livetrips\page-data\route.js",
  "$root\app\api\admin\livetrips\page-data\route.tsx"
)

$target = $targets | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $target) {
  Fail "Could not find page-data route in: app\api\admin\livetrips\page-data\route.ts (or .js/.tsx). Verify the path and rerun."
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

$src = Get-Content -LiteralPath $target -Raw

if ($src -notmatch "admin_get_live_trips_page_data") {
  Fail "Did not find 'admin_get_live_trips_page_data' in $target. Paste the file contents if your path differs."
}

# Replace only the RPC function name, keep everything else identical
$src2 = $src -replace "admin_get_live_trips_page_data_v2", "admin_get_live_trips_page_data_v2"
$src2 = $src2 -replace "admin_get_live_trips_page_data", "admin_get_live_trips_page_data_v2"

if ($src2 -eq $src) {
  Fail "No changes applied (replacement produced identical output)."
}

# Write UTF-8 (no BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $src2, $utf8NoBom)

Ok "Patched RPC call to admin_get_live_trips_page_data_v2() in: $target"
Ok "Done."
