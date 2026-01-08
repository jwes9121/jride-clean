# FIX-JRIDE_TAKEOUT_MENU_MAP_TODAY_FIELDS_V3.ps1
# - Ensure /api/takeout/menu maps is_available_today
# - Ensure it outputs sold_out_today (insert if missing)
# UTF-8 no BOM + backup

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$root = Get-Location
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$apiFile = Join-Path $root "app\api\takeout\menu\route.ts"
if (!(Test-Path $apiFile)) { Fail "Missing file: $apiFile" }

Copy-Item -Force $apiFile "$apiFile.bak.$ts"
Ok "Backup: $apiFile.bak.$ts"

$txt = [System.IO.File]::ReadAllText($apiFile)

# 1) Patch is_available mapping (replace any existing is_available block)
$reAvail = @'
is_available:
      (typeof r.is_available === "boolean" ? r.is_available : null) ??
      (typeof r.is_available_today === "boolean" ? r.is_available_today : null) ??
      (typeof r.available_today === "boolean" ? r.available_today : null) ??
      (typeof r.available === "boolean" ? r.available : null) ??
      null,
'@

if ($txt -match "(?s)\bis_available\s*:") {
  $before = $txt
  $txt = [regex]::Replace(
    $txt,
    "(?s)\bis_available\s*:\s*.*?\s*null\s*,",
    $reAvail,
    1
  )
  if ($txt -eq $before) {
    Fail "Found 'is_available:' but could not replace its block. Paste the items map() object block."
  }
} else {
  Fail "Could not find 'is_available:' in $apiFile. Paste the items map() object block."
}

# 2) Ensure sold_out_today exists (insert after is_available block if missing)
if ($txt -notmatch "(?s)\bsold_out_today\s*:") {
  $insertSold = @'
sold_out_today:
      (typeof r.sold_out_today === "boolean" ? r.sold_out_today : null) ??
      (typeof r.is_sold_out_today === "boolean" ? r.is_sold_out_today : null) ??
      null,
'@

  # Insert right after the is_available block we just standardized
  $anchor = [regex]::Escape($reAvail)
  $txt2 = [regex]::Replace($txt, $anchor, ($reAvail + $insertSold), 1)

  if ($txt2 -eq $txt) {
    Fail "Could not insert sold_out_today after is_available. Paste the items map() object block."
  }
  $txt = $txt2
  Ok "Inserted: sold_out_today mapping"
} else {
  Ok "sold_out_today mapping already present (no insert needed)."
}

[System.IO.File]::WriteAllText($apiFile, $txt, $utf8NoBom)
Ok "Patched: $apiFile"
Ok "Takeout menu mapping updated (is_available_today + sold_out_today)."
