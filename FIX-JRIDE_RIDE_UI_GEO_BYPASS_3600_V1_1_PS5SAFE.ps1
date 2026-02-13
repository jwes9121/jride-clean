param(
  [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }

function EnsureDir([string]$p){
  if (!(Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
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

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

$pkg = Join-Path $RepoRoot "package.json"
if (!(Test-Path -LiteralPath $pkg)) { Fail "[FAIL] Run from repo root (package.json not found)." }

$target = Join-Path $RepoRoot "app\ride\page.tsx"
if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] Missing: app/ride/page.tsx" }

$bak = BackupFile $target $RepoRoot
Ok ("[OK] Backup: {0}" -f $bak)
Ok ("[OK] Target: {0}" -f $target)

$src = Get-Content -LiteralPath $target -Raw

# Replace the previously injected block entirely (if present)
$begin = "/* JRIDE_UI_GEO_BYPASS_3600_BEGIN */"
$end   = "/* JRIDE_UI_GEO_BYPASS_3600_END */"

$bi = $src.IndexOf($begin)
$ei = $src.IndexOf($end)

if ($bi -lt 0 -or $ei -lt 0 -or $ei -le $bi) {
  Fail "[FAIL] Could not find existing JRIDE_UI_GEO_BYPASS_3600 block to fix. Refusing to guess."
}

$ei2 = $ei + $end.Length

$fixedBlock = @'
/* JRIDE_UI_GEO_BYPASS_3600_BEGIN */
// TEST ONLY: if local verification code is "3600", skip UI geo block so we can test auto-assign + fare proposal + trip start.
const jrideBypassGeo3600 = (String((localVerify as any) || "").trim() === "3600");
/* JRIDE_UI_GEO_BYPASS_3600_END */
'@

$src2 = $src.Substring(0, $bi) + $fixedBlock + $src.Substring($ei2)

# Ensure the IF line is correct (in case it wasn't replaced earlier)
$needleOld = 'if (geoPermission !== "granted" || geoInsideIfugao !== true) {'
$needleNew = 'if (!jrideBypassGeo3600 && (geoPermission !== "granted" || geoInsideIfugao !== true)) {'

if ($src2.Contains($needleOld)) {
  $src2 = $src2.Replace($needleOld, $needleNew)
}

WriteUtf8NoBom $target $src2
Ok "[OK] Fixed bypass block (removed localVerifyCode reference)"
Ok "[NEXT] Run: npm.cmd run build"
Ok "[DONE] FIX-JRIDE_RIDE_UI_GEO_BYPASS_3600_V1_1_PS5SAFE"
