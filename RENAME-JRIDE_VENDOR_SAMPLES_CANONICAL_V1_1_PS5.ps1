# RENAME-JRIDE_VENDOR_SAMPLES_CANONICAL_V1_1_PS5.ps1
# Canonicalize vendor sample JPG filenames by keyword search (PS5-safe)

$ErrorActionPreference = "Stop"
$dir = Join-Path (Get-Location).Path "public\vendor-samples"
if (-not (Test-Path $dir)) { throw "Missing: $dir" }

function Pick-One($pattern) {
  # Pick the largest matching file (often the real photo vs tiny thumb)
  $matches = Get-ChildItem $dir -File | Where-Object { $_.Name -match $pattern }
  if (-not $matches) { return $null }
  return ($matches | Sort-Object Length -Descending | Select-Object -First 1)
}

function Canon($pattern, $target) {
  $f = Pick-One $pattern
  if (-not $f) {
    Write-Host "[SKIP] No match for pattern: $pattern" -ForegroundColor Yellow
    return
  }

  $dst = Join-Path $dir $target

  # If a file already exists at target, remove it first
  if (Test-Path $dst) { Remove-Item -Force $dst }

  Rename-Item -Path $f.FullName -NewName $target
  Write-Host ("[REN] {0} -> {1}" -f $f.Name, $target) -ForegroundColor Green
}

Write-Host "== JRide: Canonicalize vendor sample filenames ==" -ForegroundColor Cyan
Write-Host "Folder: $dir"
Write-Host ""

# Keywords (case-insensitive by default in -match)
Canon "dinakdakan" "dinakdakan.jpg"
Canon "hamburger" "hamburger.jpg"
Canon "milktea|milk[\s_-]?tea" "milktea.jpg"
Canon "pinapaitan" "pinapaitan.jpg"

# You currently have Tinolang Native Chicken — map it to Native Chicken Soup sample slot
Canon "tinolang|tinola|native[\s_-]?chicken" "native-chicken-soup.jpg"

Write-Host ""
Write-Host "Final files:" -ForegroundColor Cyan
Get-ChildItem $dir -File | Select-Object Name,Length
