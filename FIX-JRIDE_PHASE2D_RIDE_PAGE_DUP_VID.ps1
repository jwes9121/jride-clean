# FIX-JRIDE_PHASE2D_RIDE_PAGE_DUP_VID.ps1
# Fix: app/ride/page.tsx has duplicate "const vid = ..." line inside Phase2D wrapper.
# Remove the immediate duplicate line.
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

# Collapse immediate duplicate "const vid = String(...).trim();" lines (one indented, one not)
$rx = [regex]::new('(?s)(\r?\n[ \t]*const\s+vid\s*=\s*String\(\(base\s+as\s+any\)\.vendor_id\s*\|\|\s*\(base\s+as\s+any\)\.vendorId\s*\|\|\s*jridePhase2dVendorIdFromAny\(scope\)\s*\|\|\s*""\)\.trim\(\);\s*)(\r?\n[ \t]*const\s+vid\s*=\s*String\(\(base\s+as\s+any\)\.vendor_id\s*\|\|\s*\(base\s+as\s+any\)\.vendorId\s*\|\|\s*jridePhase2dVendorIdFromAny\(scope\)\s*\|\|\s*""\)\.trim\(\);\s*)')

if (-not $rx.IsMatch($txt)) {
  Fail "Could not find an immediate duplicate 'const vid = ...' block to collapse."
}

$txt2 = $rx.Replace($txt, '$1', 1)

WriteUtf8NoBom $path $txt2
Ok "Removed duplicate const vid line."
