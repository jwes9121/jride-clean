param(
  [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
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

# Validate repo root
$pkg = Join-Path $RepoRoot "package.json"
if (!(Test-Path -LiteralPath $pkg)) {
  Fail "[FAIL] package.json not found. Run from repo root."
}

$target = Join-Path $RepoRoot "app\ride\page.tsx"
if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] Missing app\ride\page.tsx" }

$bak = BackupFile $target $RepoRoot
Ok ("[OK] Backup: {0}" -f $bak)
Ok ("[OK] Target: {0}" -f $target)

$src = Get-Content -LiteralPath $target -Raw

# Refuse if already patched
if ($src -match "JRIDE_TEST_BYPASS_GEOFENCE_BEGIN") {
  Warn "[WARN] Bypass block already present. No changes made."
  exit 0
}

# We replace this exact line:
#   const geoOk = (geoPermission === "granted" && geoInsideIfugao === true);
$needle = "const geoOk = (geoPermission === ""granted"" && geoInsideIfugao === true);"
if ($src -notlike "*$needle*") {
  Fail "[FAIL] Could not find expected geoOk line. Refusing to guess. Paste the geoOk block if you changed it."
}

$replacement = @'
  // JRIDE_TEST_BYPASS_GEOFENCE_BEGIN
  // TEST ONLY: enter this in Local verification code to bypass the Ifugao geofence UI gate:
  // JRIDE_TEST_BYPASS_20260214
  const jrideTestBypassGeo =
    (hasLocalVerify() && String(localVerify || "").trim() === "JRIDE_TEST_BYPASS_20260214");

  const geoOk = jrideTestBypassGeo || (geoPermission === "granted" && geoInsideIfugao === true);
  // JRIDE_TEST_BYPASS_GEOFENCE_END
'@

$src2 = $src.Replace($needle, $replacement)

WriteUtf8NoBom $target $src2
Ok "[OK] Patched ride geofence gate to allow test bypass code"
Ok "[DONE] PATCH-JRIDE_RIDE_GEOFENCE_BYPASS_TEST_V1_PS5SAFE"
Ok "[NEXT] Run: npm.cmd run build"
