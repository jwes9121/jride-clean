# FIX-JRIDE_RIDE_PAGE_GEOLOCATION_QUERY_ASANY.ps1
# Fix: Broken TS expression:
#   await permissions.query({ name: "geolocation" }
#   as any);
# -> await permissions.query({ name: "geolocation" } as any);
# Only touches: app/ride/page.tsx
# Backup + UTF-8 no BOM

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
$path = Join-Path $root "app\ride\page.tsx"
if (!(Test-Path $path)) { Fail "Missing file: app/ride/page.tsx" }

$bak = "$path.bak.$(Stamp)"
Copy-Item -Force $path $bak
Ok "Backup: $bak"

$txt = Get-Content -Raw $path

$pattern = '(?s)permissions\.query\(\s*\{\s*name:\s*"geolocation"\s*\}\s*\r?\n\s*as\s+any\s*\)'
if ($txt -notmatch $pattern) {
  Fail "Could not find the broken permissions.query({ name: \"geolocation\" } newline as any) pattern."
}

$txt2 = [regex]::Replace(
  $txt,
  $pattern,
  'permissions.query({ name: "geolocation" } as any)',
  1
)

WriteUtf8NoBom $path $txt2
Ok "Fixed permissions.query({ name: \"geolocation\" } as any) line"
