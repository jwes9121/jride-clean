param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
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

Info "== JRIDE Fix: Force fleet marker effect to depend on [drivers] (V1 / PS5-safe) =="
Info "Repo: $ProjRoot"
Write-Host ""

$mapPath = Join-Path $ProjRoot "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path -LiteralPath $mapPath)) { Fail "[FAIL] LiveTripsMap.tsx not found" }

$bakRoot = Join-Path $ProjRoot "_patch_bak"
$bak = BackupFile $mapPath "FORCE_FLEET_EFFECT_DEP_V1" $bakRoot
if ($bak) { Ok "[OK] Backup: $bak" }

$txt = [System.IO.File]::ReadAllText($mapPath)

# Replace ANY empty dependency array on fleet marker effect with [drivers]
$txt = $txt -replace '\},\s*\[\s*\]\s*\);', '}, [drivers]);'

# Replace incorrect arrays that include mapReady
$txt = $txt -replace '\[drivers,\s*mapReady\]', '[drivers]'
$txt = $txt -replace '\[mapReady,\s*drivers\]', '[drivers]'

WriteUtf8NoBom $mapPath $txt

Ok "[OK] Fleet marker effect now depends on [drivers]."
Ok "[NEXT] Run: npm.cmd run build"