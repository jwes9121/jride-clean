# FIX-JRIDE_LIVETRIPS_FETCH_DRIVERS_SEPARATE_V1_PS5SAFE.ps1
# Purpose:
# - LiveTrips shows Fleet:0 / DriversDebug:loaded:0 because /api/admin/livetrips/page-data does NOT return drivers.
# - Fix by fetching drivers separately from the already-working endpoint: /api/admin/driver_locations
# - No UI redesign. No Mapbox changes. Only data wiring.
# - Runs: npm.cmd run build
#
# PS5-safe, UTF-8 no BOM, includes backup.

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

Info "== JRIDE Fix: Fetch drivers separately for LiveTrips (V1 / PS5-safe) =="
$root = (Resolve-Path -LiteralPath $ProjRoot).Path
Info ("Repo: {0}" -f $root)

$clientPath = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (-not (Test-Path -LiteralPath $clientPath)) {
  Fail ("[FAIL] LiveTripsClient.tsx not found: {0}" -f $clientPath)
}

$bakDir = Join-Path $root "_patch_bak"
Backup-File $clientPath $bakDir "FETCH_DRIVERS_SEPARATE_V1"

$txt = Read-TextUtf8NoBom $clientPath

# We will inject a driver fetch right after:
#   const j = await res.json();
# inside fetchPageData().
#
# This is a narrow, deterministic insertion that avoids restructuring the whole function.

$needlePattern = 'const\s+j\s*=\s*await\s+res\.json\(\)\s*;'
$rx = New-Object System.Text.RegularExpressions.Regex($needlePattern)

$m = $rx.Match($txt)
if (-not $m.Success) {
  Fail "[FAIL] Could not find 'const j = await res.json();' in LiveTripsClient.tsx to inject driver fetch."
}

$injection = @'
const j = await res.json();

// --- JRIDE: fetch fleet drivers separately (page-data does not include drivers) ---
let driversPayload: any = null;
try {
  const drvRes = await fetch("/api/admin/driver_locations", {
    method: "GET",
    headers: { "content-type": "application/json" },
    cache: "no-store",
  });
  driversPayload = await drvRes.json();
} catch (e) {
  // ignore; keep drivers empty
  driversPayload = null;
}

const drvArr =
  Array.isArray(driversPayload) ? driversPayload :
  (Array.isArray((driversPayload as any)?.drivers) ? (driversPayload as any).drivers : []);

setDrivers(drvArr as any);
setDriversDebug(`loaded:${drvArr.length}`);
// --- end fleet drivers fetch ---
'@

# Replace the single line with our injected block (keeps same "const j" name used later)
$txt2 = $rx.Replace($txt, [System.Text.RegularExpressions.MatchEvaluator]{
  param($mm) $injection
}, 1)

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