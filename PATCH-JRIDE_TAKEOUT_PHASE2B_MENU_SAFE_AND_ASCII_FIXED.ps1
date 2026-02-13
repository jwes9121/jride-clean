# PATCH-JRIDE_TAKEOUT_PHASE2B_MENU_SAFE_AND_ASCII_FIXED.ps1
# Fix: menu API should not assume sort_order exists
# Fix: force ASCII title (avoid mojibake) WITHOUT embedding mojibake chars in this PS1
# UTF-8 no BOM + backups

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$root = Get-Location
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$takeoutPage = Join-Path $root "app\takeout\page.tsx"
$menuApi = Join-Path $root "app\api\takeout\menu\route.ts"

if (!(Test-Path $takeoutPage)) { Fail "Missing file: $takeoutPage" }
if (!(Test-Path $menuApi)) { Fail "Missing file: $menuApi" }

Copy-Item -Force $takeoutPage "$takeoutPage.bak.$ts"
Copy-Item -Force $menuApi "$menuApi.bak.$ts"
Ok "Backup: $takeoutPage.bak.$ts"
Ok "Backup: $menuApi.bak.$ts"

# -------------------------
# Patch menu API: remove .order("sort_order"...)
# -------------------------
$apiTxt = [System.IO.File]::ReadAllText($menuApi)

# Remove any line that orders by sort_order
$apiTxt2 = [regex]::Replace(
  $apiTxt,
  "(?m)^\s*\.order\(\s*['""]sort_order['""].*\)\s*;?\s*$",
  ""
)

# Ensure we end the query with ; properly if we removed a line
# (No-op if already fine)
$apiTxt2 = $apiTxt2 -replace "(?m)(\.eq\(\s*['""]vendor_id['""].*\)\s*)\r?\n(\s*\r?\n)+", "`$1`r`n"

if ($apiTxt2 -ne $apiTxt) {
  [System.IO.File]::WriteAllText($menuApi, $apiTxt2, $utf8NoBom)
  Ok "Patched: $menuApi (removed sort_order ordering)"
} else {
  Ok "Menu API: already safe (no sort_order ordering found)."
}

# -------------------------
# Patch UI title to ASCII
# We DO NOT embed mojibake sequences here.
# We just force the heading line that starts with 'Takeout (Passenger' and contains 'Phase 2B'
# -------------------------
$uiTxt = [System.IO.File]::ReadAllText($takeoutPage)

# Replace any dash variants between 'Takeout (Passenger)' and 'Phase 2B' with ASCII hyphen
# Also cleans mojibake by overwriting the full title segment.
$uiTxt2 = $uiTxt

# Replace the main visible header text node if present
$uiTxt2 = [regex]::Replace(
  $uiTxt2,
  "Takeout\s*\(Passenger\)\s*.*?\s*Phase\s*2B",
  "Takeout (Passenger) - Phase 2B"
)

if ($uiTxt2 -ne $uiTxt) {
  [System.IO.File]::WriteAllText($takeoutPage, $uiTxt2, $utf8NoBom)
  Ok "Patched: $takeoutPage (forced ASCII title)"
} else {
  Ok "UI: title pattern not found (may already be ASCII)."
}

Ok "Phase 2B menu safe + ASCII title patch applied."
Write-Host ""
Write-Host "Next: npm run build, then open /api/takeout/menu?vendor_id=... to confirm items." -ForegroundColor Cyan
