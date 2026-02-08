# CLEAN-JRIDE_VENDOR_SAMPLES_V1_PS5.ps1
# Keep only canonical PNG filenames and remove duplicates in public/vendor-samples
# PS5-safe

$ErrorActionPreference = "Stop"

$root = (Get-Location).Path
$dir = Join-Path $root "public\vendor-samples"
if (-not (Test-Path $dir)) { throw "Missing folder: $dir" }

$keep = @(
  "dinakdakan.png",
  "native-chicken-soup.png",
  "pinapaitan.png",
  "hamburger.png",
  "milktea.png"
)

Write-Host "== JRide: Clean vendor-samples ==" -ForegroundColor Cyan
Write-Host "Folder: $dir"

# Remove obvious junk patterns first
$junks = Get-ChildItem $dir -File | Where-Object {
  $_.Name -match "\.png\.jpg$" -or
  $_.Name -match "\.jpeg$" -or
  $_.Name -match "\.JPG$" -or
  $_.Name -match "\.JPEG$"
}
foreach ($f in $junks) {
  # only remove if it's not a keep file
  if ($keep -notcontains $f.Name) {
    Remove-Item -Force $f.FullName
    Write-Host ("[DEL] {0}" -f $f.Name) -ForegroundColor Yellow
  }
}

# Remove everything not in keep list
Get-ChildItem $dir -File | ForEach-Object {
  if ($keep -notcontains $_.Name) {
    Remove-Item -Force $_.FullName
    Write-Host ("[DEL] {0}" -f $_.Name) -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Remaining files:" -ForegroundColor Green
Get-ChildItem $dir -File | Select-Object Name,Length
