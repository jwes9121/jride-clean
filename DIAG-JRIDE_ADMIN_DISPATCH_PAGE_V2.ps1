# DIAG-JRIDE_ADMIN_DISPATCH_PAGE_V2.ps1
# Diagnoses why https://app.jride.net/admin/dispatch shows "This page has not been generated"
# Compatible with Windows PowerShell 5.1 and PowerShell 7+

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

$root = (Get-Location).Path
Info "Repo root: $root"

$pathsToCheck = @(
  "app\admin\dispatch\page.tsx",
  "app\admin\dispatch\page.jsx",
  "app\admin\dispatch\page.ts",
  "app\admin\dispatch\page.js",
  "app\admin\dispatch\layout.tsx",
  "app\admin\dispatch\layout.jsx",
  "middleware.ts"
)

Info "Checking key files..."
foreach ($p in $pathsToCheck) {
  $full = Join-Path $root $p
  if (Test-Path -LiteralPath $full) { Ok "Found: $p" } else { Warn "Missing: $p" }
}

$appDir = Join-Path $root "app"
if (-not (Test-Path -LiteralPath $appDir)) { throw "app/ folder not found at: $appDir" }

Info "Searching for '/admin/dispatch' references..."
Get-ChildItem -LiteralPath $appDir -Recurse -File -Include *.ts,*.tsx,*.js,*.jsx -ErrorAction SilentlyContinue |
ForEach-Object {
  $f = $_.FullName
  $t = Get-Content -LiteralPath $f -Raw
  if ($t -match "/admin/dispatch") {
    Write-Host "`n==== $f ===="
    ($t | Select-String -Pattern "/admin/dispatch" -AllMatches | Select-Object -ExpandProperty Line)
  }
}

Info "Searching for placeholder text 'This page has not been generated'..."
Get-ChildItem -LiteralPath $root -Recurse -File -Include *.ts,*.tsx,*.js,*.jsx -ErrorAction SilentlyContinue |
ForEach-Object {
  $f = $_.FullName
  $t = Get-Content -LiteralPath $f -Raw
  if ($t -match "This page has not been generated") {
    Write-Host "`n==== $f ===="
    ($t | Select-String -Pattern "This page has not been generated" -AllMatches | Select-Object -ExpandProperty Line)
  }
}

Info "Done."
