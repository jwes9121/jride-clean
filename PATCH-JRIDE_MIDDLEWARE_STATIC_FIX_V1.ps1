# PATCH-JRIDE_MIDDLEWARE_STATIC_FIX_V1.ps1
# Fix middleware hijacking static files (images, robots.txt, favicon, etc.)
# PS5-safe

$ErrorActionPreference = "Stop"

$root = (Get-Location).Path
$mw = Join-Path $root "middleware.ts"
$bakDir = Join-Path $root "_patch_bak"
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

if (-not (Test-Path $mw)) {
  throw "middleware.ts not found in repo root"
}

New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
Copy-Item $mw (Join-Path $bakDir "middleware.ts.bak.$ts")

@'
import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/|vendor-samples/|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)",
  ],
};
'@ | Set-Content -Path $mw -Encoding UTF8

Write-Host "[OK] middleware.ts patched to allow static assets" -ForegroundColor Green
