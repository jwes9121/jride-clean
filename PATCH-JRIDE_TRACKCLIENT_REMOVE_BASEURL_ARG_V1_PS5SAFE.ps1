# PATCH-JRIDE_TRACKCLIENT_REMOVE_BASEURL_ARG_V1_PS5SAFE.ps1
# Fix TS error: buildStaticMapUrl() type doesn't accept baseUrl.
# Action: remove baseUrl: (...) from the object literal passed to buildStaticMapUrl in TrackClient.tsx.
# PS5-safe, with backup, UTF-8 no BOM.

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = (Get-Location).Path
$rel  = "app\ride\track\TrackClient.tsx"
$path = Join-Path $root $rel

Info "== JRide Patch: Remove baseUrl arg from buildStaticMapUrl call (V1 / PS5-safe) =="
Info ("Target: " + $path)

if (!(Test-Path $path)) { throw ("Missing file: " + $rel + " (run from repo root)") }

# Backup
$bakDir = Join-Path $root "_patch_bak"
if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("TrackClient.tsx.bak." + $stamp)
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok ("[OK] Backup: " + $bak)

$txt  = Get-Content -Raw -LiteralPath $path
$orig = $txt

# Remove the baseUrl property from the buildStaticMapUrl({ ... }) call.
# Handles optional trailing comma.
$txt = [regex]::Replace(
  $txt,
  '(?s)(buildStaticMapUrl\(\s*\{\s*[^}]*?)\s*,?\s*baseUrl\s*:\s*\(typeof\s+window\s*!==\s*"undefined"\s*\?\s*window\.location\.origin\s*:\s*""\)\s*(\}\s*\)\s*;)',
  '$1$2',
  1
)

# Fallback: remove any "baseUrl: ..." property inside buildStaticMapUrl({ ... })
$txt = [regex]::Replace(
  $txt,
  '(?s)(buildStaticMapUrl\(\s*\{[^}]*?)\s*,?\s*baseUrl\s*:\s*[^,}]+(\s*[,}] )',
  '$1$2',
  1
)

if ($txt -eq $orig) {
  throw "No changes applied. Could not find baseUrl property in buildStaticMapUrl({ ... }) call."
}

# Save UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $txt, $utf8NoBom)

Ok "[OK] Removed baseUrl arg from buildStaticMapUrl call."
Info "NEXT: npm.cmd run build"
