# SCAN-JRIDE_VENDOR_LANDING_ROUTE_V1.ps1
# Purpose: Find where "Session: vendor" is rendered and identify the vendor landing route/page files.

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = (Get-Location).Path
Ok "== JRide Scan: Vendor landing route (V1) =="
Info ("Repo root: {0}" -f $root)

# Prefer ripgrep if available (fast). Fallback to Select-String.
$rg = Get-Command rg -ErrorAction SilentlyContinue

$patterns = @(
  "Session:\s*vendor",
  "session:\s*vendor",
  "vendor",
  "/vendor",
  "vendor/dashboard",
  "vendor/page",
  "Vendor",
  "vendor_id",
  "role.*vendor",
  "isVendor",
  "VendorLayout",
  "VendorPage"
)

# 1) Find exact string shown on screen
Info "Searching for the exact UI text: 'Session: vendor'"
if ($rg) {
  rg -n --hidden --no-ignore --glob "!**/.next/**" --glob "!**/node_modules/**" "Session:\s*vendor" .
} else {
  Get-ChildItem -Recurse -File -Force |
    Where-Object { $_.FullName -notmatch "\\node_modules\\|\\\.next\\" } |
    Select-String -Pattern "Session:\s*vendor" -List |
    ForEach-Object { "{0}:{1}:{2}" -f $_.Path,$_.LineNumber,$_.Line.Trim() }
}

# 2) Find vendor entry routes
Info ""
Info "Searching for likely vendor routes (app router): app/vendor/**, app/(vendor)/**, app/**/vendor/**"
$vendorDirs = @(
  "app\vendor",
  "app\(vendor)",
  "app\vendors",
  "src\app\vendor",
  "src\app\(vendor)"
) | ForEach-Object { Join-Path $root $_ }

foreach ($d in $vendorDirs) {
  if (Test-Path $d) { Ok ("[FOUND DIR] {0}" -f $d) } else { Warn ("[MISS DIR]  {0}" -f $d) }
}

# 3) Find pages/layouts/middleware that could block vendor
Info ""
Info "Searching for vendor-related page/layout files under app/**"
if ($rg) {
  rg -n --hidden --no-ignore --glob "!**/.next/**" --glob "!**/node_modules/**" `
    "(^|/)(page|layout)\.(tsx|ts|jsx|js)$|middleware\.(ts|js)$|auth\.ts|route\.(ts|js)$" app src/app 2>$null
} else {
  Get-ChildItem -Path (Join-Path $root "app"), (Join-Path $root "src\app") -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "^(page|layout)\.(tsx|ts|jsx|js)$|^middleware\.(ts|js)$|^auth\.ts$|^route\.(ts|js)$" } |
    ForEach-Object { $_.FullName }
}

# 4) Find redirects that might send vendor somewhere blank
Info ""
Info "Searching for redirects / router pushes referencing vendor"
if ($rg) {
  rg -n --hidden --no-ignore --glob "!**/.next/**" --glob "!**/node_modules/**" `
    "redirect\(|NextResponse\.redirect|router\.push|router\.replace|pathname|matcher|/vendor" app src/app middleware.ts middleware.js 2>$null
} else {
  Get-ChildItem -Recurse -File -Force |
    Where-Object { $_.FullName -notmatch "\\node_modules\\|\\\.next\\" } |
    Select-String -Pattern "redirect\(|NextResponse\.redirect|router\.push|router\.replace|/vendor" |
    ForEach-Object { "{0}:{1}:{2}" -f $_.Path,$_.LineNumber,$_.Line.Trim() }
}

# 5) Find "role=vendor" checks (server + client)
Info ""
Info "Searching for role/vendor gating checks (role === 'vendor', vendor_id, etc.)"
if ($rg) {
  rg -n --hidden --no-ignore --glob "!**/.next/**" --glob "!**/node_modules/**" `
    "role\s*===\s*['""]vendor['""]|role\s*==\s*['""]vendor['""]|vendor_id|isVendor|session\..*vendor" app src/app .
} else {
  Get-ChildItem -Recurse -File -Force |
    Where-Object { $_.FullName -notmatch "\\node_modules\\|\\\.next\\" } |
    Select-String -Pattern "role\s*===\s*['""]vendor['""]|role\s*==\s*['""]vendor['""]|vendor_id|isVendor|session\..*vendor" |
    ForEach-Object { "{0}:{1}:{2}" -f $_.Path,$_.LineNumber,$_.Line.Trim() }
}

Ok ""
Ok "== Done. Next: upload the files listed below (see instructions in chat). =="
