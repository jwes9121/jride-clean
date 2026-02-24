# FIX-JRIDE_LIVETRIPS_DRIVERS_OVERWRITE_GUARD_V1_PS5SAFE.ps1
# Purpose:
# - Prevent LiveTripsClient from overwriting fleet drivers to [] when page-data has no drivers
# - Converts:
#     setDrivers(Array.isArray(j?.drivers) ? j.drivers : []);
#     setDriversDebug(...)
#   into a guarded block that only applies when j.drivers exists and has items
# - Runs: npm.cmd run build
#
# PS5-safe, UTF-8 no BOM, backups included.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$ProjRoot = (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail([string]$m) { Write-Host $m -ForegroundColor Red; exit 1 }
function Ok([string]$m)   { Write-Host $m -ForegroundColor Green }
function Info([string]$m) { Write-Host $m -ForegroundColor Cyan }

function Ensure-Dir([string]$p) {
  if (-not (Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p -Force | Out-Null
  }
}

function Get-Timestamp() { (Get-Date).ToString("yyyyMMdd_HHmmss") }

function Read-TextUtf8NoBom([string]$path) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $bytes = $bytes[3..($bytes.Length-1)]
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false, $false)
  return $utf8.GetString($bytes)
}

function Write-TextUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function Backup-File([string]$src, [string]$bakDir, [string]$tag) {
  Ensure-Dir $bakDir
  $ts = Get-Timestamp
  $name = [System.IO.Path]::GetFileName($src)
  $dst = Join-Path $bakDir ("{0}.bak.{1}.{2}" -f $name, $tag, $ts)
  Copy-Item -LiteralPath $src -Destination $dst -Force
  Ok ("[OK] Backup: {0}" -f $dst)
}

Info "== JRIDE Fix: Guard drivers overwrite in LiveTripsClient (V1 / PS5-safe) =="
$root = (Resolve-Path -LiteralPath $ProjRoot).Path
Info ("Repo: {0}" -f $root)

$clientPath = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (-not (Test-Path -LiteralPath $clientPath)) {
  Fail ("[FAIL] LiveTripsClient.tsx not found: {0}" -f $clientPath)
}

$bakDir = Join-Path $root "_patch_bak"
Backup-File $clientPath $bakDir "DRIVERS_OVERWRITE_GUARD_V1"

$txt = Read-TextUtf8NoBom $clientPath
$before = $txt

# Replace the common overwrite pair:
#   setDrivers(Array.isArray(j?.drivers) ? j.drivers : []);
#   setDriversDebug(`loaded:${...}`);
#
# with a guarded block that only applies if j.drivers exists and has items.

$pattern = 'setDrivers\(\s*Array\.isArray\(j\?\.\s*drivers\)\s*\?\s*j\.drivers\s*:\s*\[\]\s*\)\s*;\s*[\r\n]+\s*setDriversDebug\(\s*`loaded:\$\{\s*\(Array\.isArray\(j\?\.\s*drivers\)\s*\?\s*j\.drivers\.length\s*:\s*0\s*\)\s*\}`\s*\)\s*;'
$rx = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)

if (-not $rx.IsMatch($txt)) {
  # Fallback: just guard any setDrivers(j?.drivers) + setDriversDebug block variants
  $pattern2 = 'setDrivers\(\s*Array\.isArray\(j\?\.\s*drivers\)\s*\?\s*j\.drivers\s*:\s*\[\]\s*\)\s*;\s*[\s\S]{0,200}?setDriversDebug\([\s\S]*?\)\s*;'
  $rx = New-Object System.Text.RegularExpressions.Regex($pattern2, [System.Text.RegularExpressions.RegexOptions]::Singleline)
}

if (-not $rx.IsMatch($txt)) {
  Fail "[FAIL] Could not find the drivers overwrite lines in LiveTripsClient.tsx to patch."
}

$replacement = @'
const pageDrivers = (Array.isArray((j as any)?.drivers) ? ((j as any).drivers as any[]) : null);
if (pageDrivers && pageDrivers.length > 0) {
  setDrivers(pageDrivers as any);
  setDriversDebug(`loaded:${pageDrivers.length}`);
}
'@

$txt2 = $rx.Replace($txt, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $replacement }, 1)

if ($txt2 -eq $before) {
  Fail "[FAIL] Patch produced no changes (unexpected)."
}

Write-TextUtf8NoBom $clientPath $txt2
Ok ("[OK] Patched: {0}" -f $clientPath)

Info "== Running build =="
Push-Location $root
try {
  & npm.cmd run build
  Ok "[OK] npm run build finished"
} finally {
  Pop-Location
}

Ok "== Done =="
Ok "Next: git commit + tag + push (commands below)"