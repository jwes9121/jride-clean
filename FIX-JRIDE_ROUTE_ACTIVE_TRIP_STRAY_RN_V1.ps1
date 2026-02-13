# FIX-JRIDE_ROUTE_ACTIVE_TRIP_STRAY_RN_V1.ps1
# Removes stray "r`n" / "\r\n" junk injected into route.ts and normalizes line endings.
# PS5-safe.

$ErrorActionPreference="Stop"
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red; throw $m }

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

$root=(Get-Location).Path
if (!(Test-Path (Join-Path $root "package.json"))) { Fail "Run from repo root (package.json)." }

$f = Join-Path $root "app\api\driver\active-trip\route.ts"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $root "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir ("route.ts.active-trip.bak.{0}" -f $ts)
Copy-Item -Force $f $bak
Ok "[OK] Backup: $bak"

$src = Get-Content -Raw -Path $f

# Remove common junk sequences that appear as literal text in TS
$src2 = $src
$src2 = $src2 -replace "r`n", ""                 # literal r<newline> often injected
$src2 = $src2 -replace "\\r\\n", ""              # literal "\r\n"
$src2 = $src2 -replace "`r`n`r`n`r`n", "`r`n`r`n"

if ($src2 -eq $src) {
  Warn "[WARN] No obvious junk found. We'll still rewrite UTF8-noBOM."
} else {
  Ok "[OK] Removed stray junk sequences"
}

WriteUtf8NoBom $f $src2
Ok "[OK] Wrote: $f"

# Quick sanity: show the suspicious line area around the first occurrence of "isMovementState"
Ok "[INFO] Snippet:"
Select-String -Path $f -Pattern "isMovementState" -Context 2,2 | Select-Object -First 1 | ForEach-Object {
  $_.Context.PreContext
  $_.Line
  $_.Context.PostContext
} | Out-Host

Ok "=== DONE: active-trip route.ts cleaned ==="
Ok "[NEXT] npm.cmd run build"
