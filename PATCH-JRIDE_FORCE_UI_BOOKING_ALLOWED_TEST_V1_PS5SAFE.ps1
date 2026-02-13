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

$target = Join-Path $RepoRoot "app\ride\page.tsx"
if (!(Test-Path -LiteralPath $target)) {
  Fail "[FAIL] Could not find app\ride\page.tsx"
}

$bak = BackupFile $target $RepoRoot
Ok "[OK] Backup created"

$src = Get-Content -LiteralPath $target -Raw

if ($src -like "*JRIDE_FORCE_UI_BOOKING_ALLOWED_BEGIN*") {
  Ok "[OK] Already forced. Nothing changed."
  exit 0
}

# Replace any geoOrLocalOk declaration with forced true
$pattern = '(?m)^\s*const\s+geoOrLocalOk\s*=.*?;'
$match = [regex]::Match($src, $pattern)

if (-not $match.Success) {
  Fail "[FAIL] Could not find geoOrLocalOk line."
}

$newLine = @'
  /* JRIDE_FORCE_UI_BOOKING_ALLOWED_BEGIN */
  const geoOrLocalOk = true;
  /* JRIDE_FORCE_UI_BOOKING_ALLOWED_END */
'@

$src2 = $src.Remove($match.Index, $match.Length).Insert($match.Index, $newLine)

WriteUtf8NoBom $target $src2

Ok "[OK] UI geofence gate disabled for testing"
Ok "[NEXT] Run: npm.cmd run build"
