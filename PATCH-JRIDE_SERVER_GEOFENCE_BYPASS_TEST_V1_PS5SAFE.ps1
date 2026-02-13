param(
  [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function EnsureDir([string]$p){
  if (!(Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}
function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  EnsureDir (Split-Path -Parent $path)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}
function BackupFile([string]$path, [string]$repoRoot) {
  $bakDir = Join-Path $repoRoot "_patch_bak"
  EnsureDir $bakDir
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = [System.IO.Path]::GetFileName($path)
  $bak = Join-Path $bakDir ("{0}.bak.{1}" -f $name, $ts)
  Copy-Item -LiteralPath $path -Destination $bak -Force
  return $bak
}

$target = Join-Path $RepoRoot "app\api\public\passenger\book\route.ts"
if (!(Test-Path -LiteralPath $target)) {
  Fail "[FAIL] Could not find book route.ts"
}

$bak = BackupFile $target $RepoRoot
Ok "[OK] Backup created"

$src = Get-Content -LiteralPath $target -Raw

if ($src -like "*JRIDE_TEST_BYPASS_GEO_BEGIN*") {
  Ok "[OK] Test bypass already enabled"
  exit 0
}

# Insert test bypass constant near top
$insertPoint = $src.IndexOf("export async function")
if ($insertPoint -lt 0) {
  Fail "[FAIL] Could not locate export async function in route.ts"
}

$block = @'

/* JRIDE_TEST_BYPASS_GEO_BEGIN */
// TEST MODE: bypass geofence checks entirely
const JRIDE_TEST_BYPASS_GEO = true;
/* JRIDE_TEST_BYPASS_GEO_END */

'@

$src2 = $src.Insert($insertPoint, $block)

# Now disable geo validation logic by short-circuiting typical check
$src2 = $src2 -replace "if\s*\(\s*!geoAllowed\s*\)", "if (!geoAllowed && !JRIDE_TEST_BYPASS_GEO)"

WriteUtf8NoBom $target $src2
Ok "[OK] Server-side geofence bypass enabled (TEST MODE)"
Ok "[NEXT] Run: npm.cmd run build"
