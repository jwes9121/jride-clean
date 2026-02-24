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

Info "== JRIDE Patch: Fix DispatchActionPanel import in LiveTripsMap (V1 / PS5-safe) =="
Info "Repo: $ProjRoot"
Write-Host ""

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$bakRoot = Join-Path $ProjRoot "_patch_bak"
$mapPath = Join-Path $ProjRoot "app\admin\livetrips\components\LiveTripsMap.tsx"

if (!(Test-Path -LiteralPath $mapPath)) { Fail "[FAIL] LiveTripsMap.tsx not found: $mapPath" }

$bak = BackupFile $mapPath "DISPATCHACTIONPANEL_IMPORT_V1" $bakRoot
if ($bak) { Ok "[OK] Backup: $bak" }

# Read (as UTF8) then rewrite (UTF8 no BOM)
$txt = [System.IO.File]::ReadAllText($mapPath, [System.Text.Encoding]::UTF8)

# Replace named import with default import (handles spacing)
$pattern = 'import\s*\{\s*DispatchActionPanel\s*\}\s*from\s*["'']\./DispatchActionPanel["''];'
$replacement = 'import DispatchActionPanel from "./DispatchActionPanel";'

$txt2 = [System.Text.RegularExpressions.Regex]::Replace(
  $txt,
  $pattern,
  $replacement,
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)

if ($txt2 -eq $txt) {
  # Fallback: if file already uses different quotes or formatting, try a simpler replace
  $txt2 = $txt2.Replace('import { DispatchActionPanel } from "./DispatchActionPanel";', $replacement)
  $txt2 = $txt2.Replace("import { DispatchActionPanel } from './DispatchActionPanel';", $replacement)
}

# Verify the correct import exists now
if ($txt2 -notmatch 'import\s+DispatchActionPanel\s+from\s+["'']\./DispatchActionPanel["'']\s*;') {
  Fail "[FAIL] Could not apply import fix. LiveTripsMap.tsx may have a different import line. Open file and search for DispatchActionPanel import."
}

WriteUtf8NoBom $mapPath $txt2
Ok "[OK] Patched LiveTripsMap.tsx to use default import for DispatchActionPanel (UTF-8 no BOM)."

Ok "[NEXT] Run: npm.cmd run build"