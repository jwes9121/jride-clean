param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $dir = Split-Path -Parent $path
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function BackupFile([string]$absPath, [string]$tag, [string]$bakRoot) {
  if (!(Test-Path -LiteralPath $absPath)) { return $null }
  New-Item -ItemType Directory -Force -Path $bakRoot | Out-Null
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = Split-Path -Leaf $absPath
  $bak = Join-Path $bakRoot ($name + ".bak." + $tag + "." + $ts)
  Copy-Item -LiteralPath $absPath -Destination $bak -Force
  return $bak
}

Info "== JRIDE Fix: driver_locations circular GET alias (V2 / PS5-safe) =="
Info "Repo: $ProjRoot"
Write-Host ""

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$bakRoot = Join-Path $ProjRoot "_patch_bak"

# Target files
$adminUnderscore = Join-Path $ProjRoot "app\api\admin\driver_locations\route.ts"
$adminHyphen     = Join-Path $ProjRoot "app\api\admin\driver-locations\route.ts"
$rootUnderscore  = Join-Path $ProjRoot "app\api\driver_locations\route.ts"
$rootHyphen      = Join-Path $ProjRoot "app\api\driver-locations\route.ts"

# Must exist: the real implementation should be in root underscore
if (!(Test-Path -LiteralPath $rootUnderscore)) {
  Fail "[FAIL] Missing canonical implementation: $rootUnderscore"
}

Info "== Backups =="
foreach ($p in @($adminUnderscore,$adminHyphen,$rootHyphen)) {
  $bak = BackupFile $p "DRVLOC_CIRCULAR_FIX_V2" $bakRoot
  if ($bak) { Ok "[OK] Backup: $bak" }
}

Write-Host ""
Info "== Writing deterministic one-way aliases (NO circular/self alias) =="

# 1) Root hyphen: /api/driver-locations -> /api/driver_locations
# From app/api/driver-locations/route.ts to sibling app/api/driver_locations/route.ts:
#   ../driver_locations/route
$rootHyphenContent = "export { GET } from `"../driver_locations/route`";`n"
WriteUtf8NoBom $rootHyphen $rootHyphenContent
Ok "[OK] Wrote: app/api/driver-locations/route.ts -> ../driver_locations/route"

# 2) Admin hyphen: /api/admin/driver-locations -> /api/admin/driver_locations
# From app/api/admin/driver-locations/route.ts to sibling app/api/admin/driver_locations/route.ts:
#   ../driver_locations/route
$adminHyphenContent = "export { GET } from `"../driver_locations/route`";`n"
WriteUtf8NoBom $adminHyphen $adminHyphenContent
Ok "[OK] Wrote: app/api/admin/driver-locations/route.ts -> ../driver_locations/route"

# 3) Admin underscore: /api/admin/driver_locations -> root implementation /api/driver_locations
# CRITICAL: It must NOT point to ../driver-locations or ../driver_locations (those are self/sibling loops).
# From app/api/admin/driver_locations/route.ts up to app/api then driver_locations:
#   ../../driver_locations/route
$adminUnderscoreContent = "export { GET } from `"../../driver_locations/route`";`n"
WriteUtf8NoBom $adminUnderscore $adminUnderscoreContent
Ok "[OK] Wrote: app/api/admin/driver_locations/route.ts -> ../../driver_locations/route (breaks circular alias)"

Write-Host ""
Info "== Quick sanity checks =="
# Detect accidental self/sibling alias in admin underscore
$adminText = [System.IO.File]::ReadAllText($adminUnderscore, [System.Text.Encoding]::UTF8)
if ($adminText -match 'driver-locations' -or $adminText -match 'export\s*\{\s*GET\s*\}\s*from\s*"\.\.\/driver_locations\/route"') {
  Fail "[FAIL] admin/driver_locations/route.ts still contains a circular/self alias. Aborting."
}
Ok "[OK] admin/driver_locations/route.ts does not self-alias."

Ok "[NEXT] Run: npm.cmd run build"