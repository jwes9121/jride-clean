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

Info "== JRIDE Fix: Remove duplicate drivers prop in LiveTripsMapProps (V1 / PS5-safe) =="
Info "Repo: $ProjRoot"
Write-Host ""

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$mapPath = Join-Path $ProjRoot "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path -LiteralPath $mapPath)) { Fail "[FAIL] LiveTripsMap.tsx not found: $mapPath" }

$bakRoot = Join-Path $ProjRoot "_patch_bak"
$bak = BackupFile $mapPath "REMOVE_DUP_DRIVERS_PROP_V1" $bakRoot
if ($bak) { Ok "[OK] Backup: $bak" }

$txt = [System.IO.File]::ReadAllText($mapPath, [System.Text.Encoding]::UTF8)

# Remove the duplicate line we added earlier:
#   drivers?: any[]; // fleet drivers from /api/admin/driver_locations
$before = $txt.Length
$txt = [System.Text.RegularExpressions.Regex]::Replace(
  $txt,
  '(?m)^\s*drivers\?\s*:\s*any\[\]\s*;\s*//\s*fleet\s*drivers\s*from\s*/api/admin/driver_locations\s*\r?\n',
  ''
)

if ($txt.Length -eq $before) {
  # Fallback: remove any "drivers?: any[];" line (comment or no comment)
  $txt = [System.Text.RegularExpressions.Regex]::Replace(
    $txt,
    '(?m)^\s*drivers\?\s*:\s*any\[\]\s*;\s*.*\r?\n',
    ''
  )
}

WriteUtf8NoBom $mapPath $txt
Ok "[OK] Removed duplicate drivers?: any[] line (if present)."
Ok "[NEXT] Run: npm.cmd run build"