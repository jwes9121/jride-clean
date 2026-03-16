param(
  [string]$WebRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

function Write-Section([string]$title) {
  Write-Host ""
  Write-Host ("=" * 90) -ForegroundColor DarkGray
  Write-Host $title -ForegroundColor Cyan
  Write-Host ("=" * 90) -ForegroundColor DarkGray
}

function Read-Text([string]$path) {
  if (!(Test-Path $path)) { throw "Missing file: $path" }
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

Write-Section "JRIDE DIAG ROUTE LOCAL BUILD CHECK V1"

Write-Host "WebRoot: $WebRoot"

$diagRoute = Join-Path $WebRoot "app\api\_diag\book-headers\route.ts"

Write-Section "1) VERIFY ROUTE FILE EXISTS"

if (Test-Path $diagRoute) {
  Write-Host "[OK] Found: $diagRoute" -ForegroundColor Green
} else {
  Write-Host "[MISS] $diagRoute" -ForegroundColor Yellow
  exit 1
}

Write-Section "2) SHOW ROUTE FILE CONTENT"

Read-Text $diagRoute | Write-Host

Write-Section "3) GIT STATUS FOR THE ROUTE"

Push-Location $WebRoot
git status --short -- "app/api/_diag/book-headers/route.ts"
Pop-Location

Write-Section "4) LOCAL NEXT BUILD"

Push-Location $WebRoot
npm run build
Pop-Location

Write-Section "5) CHECK .NEXT OUTPUT FOR THE ROUTE"

$nextServerApp = Join-Path $WebRoot ".next\server\app"
if (Test-Path $nextServerApp) {
  Write-Host "[OK] Found build output folder: $nextServerApp" -ForegroundColor Green
} else {
  Write-Host "[MISS] Build output folder not found: $nextServerApp" -ForegroundColor Yellow
}

$matches = @()
if (Test-Path (Join-Path $WebRoot ".next")) {
  $matches = Get-ChildItem -Path (Join-Path $WebRoot ".next") -Recurse -File |
    Where-Object {
      $_.FullName -match 'book-headers' -or $_.FullName -match 'app-path-routes-manifest'
    }
}

if ($matches.Count -gt 0) {
  $matches | ForEach-Object { Write-Host $_.FullName }
} else {
  Write-Host "[NO MATCHES] No .next files matched 'book-headers' or route manifest search." -ForegroundColor Yellow
}

Write-Section "6) SEARCH MANIFESTS FOR /api/_diag/book-headers"

$manifestFiles = Get-ChildItem -Path (Join-Path $WebRoot ".next") -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -match 'manifest'
  }

$foundManifestHit = $false
foreach ($mf in $manifestFiles) {
  try {
    $txt = Read-Text $mf.FullName
    if ($txt -match '/api/_diag/book-headers') {
      $foundManifestHit = $true
      Write-Host ("[HIT] " + $mf.FullName) -ForegroundColor Green
    }
  } catch {}
}

if (-not $foundManifestHit) {
  Write-Host "[NO HIT] No manifest contained /api/_diag/book-headers" -ForegroundColor Yellow
}

Write-Section "7) DONE"

Write-Host "No files were modified by this script." -ForegroundColor Green