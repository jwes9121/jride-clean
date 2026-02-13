# PATCH-JRIDE_VENDOR_BULLET_FIX_V1_4_PS5.ps1
# Fix mojibake bullets by replacing bullet symbols with ASCII hyphens
# PS5-safe, vendor-orc / vendor-orders / vendor-order aware

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }

$root = (Get-Location).Path
$ts = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bakDir = Join-Path $root "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null

# locate vendor page
$candidates = @(
  "app\vendor-orc\page.tsx",
  "app\vendor-orders\page.tsx",
  "app\vendor-order\page.tsx"
)

$vendorFile = $null
foreach ($c in $candidates) {
  $p = Join-Path $root $c
  if (Test-Path $p) { $vendorFile = $p; break }
}

if (-not $vendorFile) {
  throw "Vendor page not found."
}

Ok ("[OK] Vendor page: {0}" -f $vendorFile)

# backup
$bak = Join-Path $bakDir ("vendor_page.tsx.bak.{0}" -f $ts)
Copy-Item -Force $vendorFile $bak
Ok ("[OK] Backup: {0}" -f $bak)

$txt = Get-Content -Raw -Path $vendorFile -Encoding UTF8

# Replace bullet characters and their broken variants with hyphens
$txt = $txt.Replace("• ", "- ")
$txt = $txt.Replace("â€¢ ", "- ")
$txt = $txt.Replace("â€¢", "-")

Set-Content -Path $vendorFile -Value $txt -Encoding UTF8
Ok "[OK] Replaced bullet symbols with ASCII hyphens"

Ok "DONE. Next: npm.cmd run build"
