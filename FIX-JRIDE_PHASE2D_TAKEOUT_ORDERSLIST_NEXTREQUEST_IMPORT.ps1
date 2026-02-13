# FIX-JRIDE_PHASE2D_TAKEOUT_ORDERSLIST_NEXTREQUEST_IMPORT.ps1
# Fix: POST(req: NextRequest) added but NextRequest not imported.
# Only touches: app/api/takeout/orders-list/route.ts
# Backup + UTF-8 no BOM.

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $sw = New-Object System.IO.StreamWriter($path, $false, $utf8NoBom)
  try { $sw.Write($content) } finally { $sw.Dispose() }
}

$root = (Get-Location).Path
$path = Join-Path $root "app\api\takeout\orders-list\route.ts"
if (!(Test-Path $path)) { Fail "Missing file: app\api\takeout\orders-list\route.ts" }

$bak = "$path.bak.$(Stamp)"
Copy-Item -Force $path $bak
Ok "Backup: $bak"

$txt = Get-Content -Raw $path

# If already imports NextRequest, no-op
if ($txt -match 'import\s*\{\s*NextRequest\s*,\s*NextResponse\s*\}\s*from\s*"next/server"\s*;') {
  Ok "NextRequest already imported. No changes."
  exit 0
}

# Common case: import { NextResponse } from "next/server";
if ($txt -match 'import\s*\{\s*NextResponse\s*\}\s*from\s*"next/server"\s*;') {
  $txt2 = [regex]::Replace(
    $txt,
    'import\s*\{\s*NextResponse\s*\}\s*from\s*"next/server"\s*;',
    'import { NextRequest, NextResponse } from "next/server";',
    1
  )
  WriteUtf8NoBom $path $txt2
  Ok "Updated next/server import to include NextRequest."
  exit 0
}

# If next/server import exists but different form, try to add NextRequest into braces
if ($txt -match 'import\s*\{\s*([^}]*)\}\s*from\s*"next/server"\s*;') {
  $txt2 = [regex]::Replace(
    $txt,
    'import\s*\{\s*([^}]*)\}\s*from\s*"next/server"\s*;',
    {
      param($m)
      $inside = $m.Groups[1].Value
      if ($inside -match '\bNextRequest\b') { return $m.Value }
      $insideTrim = $inside.Trim()
      if ([string]::IsNullOrWhiteSpace($insideTrim)) {
        return 'import { NextRequest } from "next/server";'
      }
      # Ensure NextResponse remains if it existed
      return 'import { NextRequest, ' + $insideTrim + ' } from "next/server";'
    },
    1
  )
  WriteUtf8NoBom $path $txt2
  Ok "Inserted NextRequest into existing next/server import."
  exit 0
}

Fail "Could not find next/server import to edit. Paste first 30 lines of app/api/takeout/orders-list/route.ts."
