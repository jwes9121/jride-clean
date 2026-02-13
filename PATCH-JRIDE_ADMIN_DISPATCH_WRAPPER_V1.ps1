# PATCH-JRIDE_ADMIN_DISPATCH_WRAPPER_V1.ps1
# Creates app/admin/dispatch/page.tsx that re-exports existing app/dispatch/page.tsx
# Fixes /admin/dispatch showing "This page has not been generated"

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

$root = (Get-Location).Path

$src = Join-Path $root "app\dispatch\page.tsx"
if (-not (Test-Path -LiteralPath $src)) {
  throw "Missing source page: $src (you said you have app/dispatch/page.tsx)"
}

$destDir = Join-Path $root "app\admin\dispatch"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null

$dest = Join-Path $destDir "page.tsx"

if (Test-Path -LiteralPath $dest) {
  Warn "Already exists: $dest"
  Warn "No changes made."
  exit 0
}

$content = @'
export { default } from "../../dispatch/page";
'@

Set-Content -LiteralPath $dest -Value $content -Encoding UTF8
Ok "Created: app/admin/dispatch/page.tsx -> re-export to /dispatch"

Info "Build locally now (required)."
