# FIX-JRIDE_LIVETRIPS_REMOVE_STRAY_EMERGENCY_V1_2_PS5SAFE.ps1
# Removes stray standalone line: EMERGENCY
# PS5-safe, UTF-8 no BOM, backups

param(
  [Parameter(Mandatory=$false)]
  [string]$ProjRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }
function Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function Ok($msg)   { Write-Host $msg -ForegroundColor Green }

$proj = (Resolve-Path -LiteralPath $ProjRoot).Path
$target = Join-Path $proj "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] Not found: $target" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $proj ("_patch_bak\LIVETRIPS_REMOVE_STRAY_EMERGENCY_V1_2_" + $ts)
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null

$rel = $target.Substring($proj.Length).TrimStart('\')
$bakPath = Join-Path $bakDir $rel
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $bakPath) | Out-Null
Copy-Item -LiteralPath $target -Destination $bakPath -Force
Ok "[OK] Backup: $bakPath"

# UTF-8 no BOM read/write
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$bytes = [System.IO.File]::ReadAllBytes($target)
$txt = [System.Text.Encoding]::UTF8.GetString($bytes)

# Remove ONLY lines that are exactly "EMERGENCY" (with optional whitespace)
# Multiline mode anchors ^ $
$fixed = [System.Text.RegularExpressions.Regex]::Replace(
  $txt,
  '^\s*EMERGENCY\s*$\r?\n?',
  '',
  [System.Text.RegularExpressions.RegexOptions]::Multiline
)

if ($fixed -eq $txt) {
  Info "[INFO] No standalone EMERGENCY line found; nothing changed."
  exit 0
}

$outBytes = $utf8NoBom.GetBytes($fixed)
[System.IO.File]::WriteAllBytes($target, $outBytes)
Ok "[OK] Removed standalone EMERGENCY line(s): $target"