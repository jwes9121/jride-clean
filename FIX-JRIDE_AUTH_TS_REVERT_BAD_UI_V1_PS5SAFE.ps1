param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

Write-Host "== FIX JRIDE: Revert corrupted auth.ts (remove JSX injected by patch) V1 / PS5-safe ==" -ForegroundColor Cyan
if (!(Test-Path $ProjRoot)) { throw "ProjRoot not found: $ProjRoot" }

$proj = (Resolve-Path $ProjRoot).Path
$bakDir = Join-Path $proj "_patch_bak"
$authPath = Join-Path $proj "auth.ts"

if (!(Test-Path $bakDir)) { throw "Backup folder not found: $bakDir" }
if (!(Test-Path $authPath)) { throw "auth.ts not found: $authPath" }

# Find latest backup created by that patch run
$bak = Get-ChildItem -LiteralPath $bakDir -File -Filter "auth.ts.bak.PASSENGER_LOGIN_UI_V1.*" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (!$bak) {
  throw "No backup found matching: auth.ts.bak.PASSENGER_LOGIN_UI_V1.* in $bakDir"
}

# Backup current broken file (just in case)
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$brokenBak = Join-Path $bakDir ("auth.ts.bak.BROKEN_UI_" + $stamp)
Copy-Item -LiteralPath $authPath -Destination $brokenBak -Force
Write-Host "[OK] Backed up current auth.ts -> $brokenBak" -ForegroundColor Green

# Restore
Copy-Item -LiteralPath $bak.FullName -Destination $authPath -Force
Write-Host "[OK] Restored auth.ts from -> $($bak.FullName)" -ForegroundColor Green

# Sanity: auth.ts must not contain JSX tags
$raw = Get-Content -LiteralPath $authPath -Raw
if ($raw -match "<div\s|<input\s|className\s*=") {
  Write-Host "[FAIL] Restored auth.ts still looks like it contains JSX. Stop." -ForegroundColor Red
  throw "auth.ts still contains JSX markers"
}

Write-Host "[DONE] auth.ts is clean (no JSX markers found)." -ForegroundColor Green