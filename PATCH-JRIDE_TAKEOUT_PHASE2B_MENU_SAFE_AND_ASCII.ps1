# PATCH-JRIDE_TAKEOUT_PHASE2B_MENU_SAFE_AND_ASCII.ps1
# Fix: menu API should not assume sort_order exists; UI sorts client-side
# Fix: remove mojibake by using ASCII-only title
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

# ---------- Patch menu API: remove .order("sort_order") assumptions ----------
$apiTxt = [System.IO.File]::ReadAllText($menuApi)

# Replace the query block to be order-agnostic
# We look for: .from("vendor_menu_today") ... .eq("vendor_id", vendor_id) ... .order("sort_order"...)
$apiTxt2 = $apiTxt

# Remove any order("sort_order"... ) line safely
$apiTxt2 = [regex]::Replace(
  $apiTxt2,
  "(?m)^\s*\.order\(\s*[""']sort_order[""']\s*,\s*\{\s*ascending\s*:\s*true\s*\}\s*\)\s*;\s*$",
  ";"
)

# If it used .order(...) without semicolon handling, also remove generic sort_order order line
$apiTxt2 = [regex]::Replace(
  $apiTxt2,
  "(?m)^\s*\.order\(\s*[""']sort_order[""'].*\)\s*$",
  ""
)

# Add a .limit(500) if not present (safe)
if ($apiTxt2 -notmatch "\.limit\(") {
  $apiTxt2 = [regex]::Replace(
    $apiTxt2,
    "(\.eq\(\s*[""']vendor_id[""']\s*,\s*vendor_id\s*\)\s*)",
    "`$1`r`n    .limit(500)"
  )
}

if ($apiTxt2 -eq $apiTxt) {
  Ok "Menu API: no changes needed (anchors not found or already safe)."
} else {
  [System.IO.File]::WriteAllText($menuApi, $apiTxt2, $utf8NoBom)
  Ok "Patched: $menuApi"
}

# ---------- Patch takeout page title to ASCII-only ----------
$uiTxt = [System.IO.File]::ReadAllText($takeoutPage)

# Replace any mojibake or en-dash in the header text
$uiTxt2 = $uiTxt
$uiTxt2 = $uiTxt2.Replace("Takeout (Passenger) – Phase 2B", "Takeout (Passenger) - Phase 2B")
$uiTxt2 = $uiTxt2.Replace("Takeout (Passenger) — Phase 2B", "Takeout (Passenger) - Phase 2B")
$uiTxt2 = $uiTxt2.Replace("Takeout (Passenger) - Phase 2B", "Takeout (Passenger) - Phase 2B")
$uiTxt2 = $uiTxt2.Replace("Takeout (Passenger) - Phase 2B", "Takeout (Passenger) - Phase 2B")

# Extra hardening: replace common mojibake sequences if they appear
$uiTxt2 = $uiTxt2.Replace("-", "-").Replace("-", "-").Replace("â€", "")

if ($uiTxt2 -eq $uiTxt) {
  Ok "UI: no mojibake replacements applied (already clean)."
} else {
  [System.IO.File]::WriteAllText($takeoutPage, $uiTxt2, $utf8NoBom)
  Ok "Patched: $takeoutPage"
}

Ok "Phase 2B menu safe ordering + ASCII title patch applied."
Write-Host ""
Write-Host "Next: npm run build, then test /api/takeout/menu?vendor_id=... and /takeout" -ForegroundColor Cyan
