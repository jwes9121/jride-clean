# EXPORT-TAKEOUT-ORDER-CREATE-PAGE.ps1
# Finds and exports the TAKEOUT "create order" page: app\takeout\orders\page.tsx
# Produces a zip you can upload here.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$repo = "C:\Users\jwes9\Desktop\jride-clean-fresh"
if (!(Test-Path $repo)) { Fail "Repo not found: $repo" }

$target = Join-Path $repo "app\takeout\orders\page.tsx"
if (!(Test-Path $target)) {
  Write-Host "[INFO] Expected file not found at: $target" -ForegroundColor Yellow

  Write-Host "`nSearching for any takeout orders create page candidates..." -ForegroundColor Cyan
  $cands = Get-ChildItem -Path (Join-Path $repo "app\takeout\orders") -Recurse -File -Filter "page.tsx" -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName

  if (!$cands -or $cands.Count -eq 0) { Fail "No page.tsx found under app\takeout\orders" }

  Write-Host "`nFound these page.tsx files:" -ForegroundColor Cyan
  $cands | ForEach-Object { Write-Host " - $_" }

  Fail "The create page should be app\takeout\orders\page.tsx. If your structure is different, upload the correct create page from the list above."
}

Write-Host "[OK] Found create page: $target" -ForegroundColor Green

# Create zip in repo root
$zip = Join-Path $repo "TAKEOUT_CREATE_PAGE_ONLY.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

Compress-Archive -Path $target -DestinationPath $zip -Force

Write-Host "[OK] Created zip: $zip" -ForegroundColor Green
Write-Host "Upload this file here: TAKEOUT_CREATE_PAGE_ONLY.zip" -ForegroundColor Cyan
