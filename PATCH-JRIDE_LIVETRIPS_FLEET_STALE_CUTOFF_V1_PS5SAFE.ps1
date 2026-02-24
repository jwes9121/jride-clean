# PATCH-JRIDE_LIVETRIPS_FLEET_STALE_CUTOFF_V1_PS5SAFE.ps1
# Purpose:
# - Hide stale fleet driver markers to avoid incorrect dispatcher view
# - Stale cutoff (minutes): default 10
# - Works with drivers rows containing updated_at (ISO string)
# - Runs: npm.cmd run build
#
# PS5-safe, backups included.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$ProjRoot = (Get-Location).Path,

  [Parameter(Mandatory = $false)]
  [int]$StaleMinutes = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail([string]$m) { Write-Host $m -ForegroundColor Red; exit 1 }
function Ok([string]$m)   { Write-Host $m -ForegroundColor Green }
function Info([string]$m) { Write-Host $m -ForegroundColor Cyan }

function Ensure-Dir([string]$p) {
  if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}
function Get-Timestamp() { (Get-Date).ToString("yyyyMMdd_HHmmss") }

function Read-TextUtf8NoBom([string]$path) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $bytes = $bytes[3..($bytes.Length-1)]
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false, $false)
  $utf8.GetString($bytes)
}

function Write-TextUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function Backup-File([string]$src, [string]$bakDir, [string]$tag) {
  Ensure-Dir $bakDir
  $dst = Join-Path $bakDir ("{0}.bak.{1}.{2}" -f ([IO.Path]::GetFileName($src)), $tag, (Get-Timestamp))
  Copy-Item -LiteralPath $src -Destination $dst -Force
  Ok ("[OK] Backup: {0}" -f $dst)
}

Info "== JRIDE Patch: Fleet stale cutoff (V1 / PS5-safe) =="
$root = (Resolve-Path -LiteralPath $ProjRoot).Path
Info ("Repo: {0}" -f $root)

$mapPath = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"
if (-not (Test-Path -LiteralPath $mapPath)) { Fail ("[FAIL] LiveTripsMap.tsx not found: {0}" -f $mapPath) }

$bakDir = Join-Path $root "_patch_bak"
Backup-File $mapPath $bakDir "FLEET_STALE_CUTOFF_V1"

$txt = Read-TextUtf8NoBom $mapPath

# We patch inside the fleet markers effect loop:
# for (const d of drivers as any[]) { ... }
# We insert stale filtering right after lat/lng parsing.

$pattern = 'for\s*\(\s*const\s+d\s+of\s+drivers\s+as\s+any\[\]\s*\)\s*\{\s*[\s\S]*?const\s+id\s*=\s*String\(d\?\.(driver_id|driverId|id)[\s\S]*?\);\s*[\s\S]*?const\s+lat\s*=\s*num\(d\?\.\s*lat\);\s*[\s\S]*?const\s+lng\s*=\s*num\(d\?\.\s*lng\);\s*[\s\S]*?if\s*\(\s*!id\s*\|\|\s*lat\s*==\s*null\s*\|\|\s*lng\s*==\s*null\s*\)\s*continue\s*;'
$rx = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)

if (-not $rx.IsMatch($txt)) {
  Fail "[FAIL] Could not locate the fleet loop lat/lng section to inject stale cutoff. Your LiveTripsMap.tsx fleet effect differs from expected."
}

$inject = @"
`$0

      // --- JRIDE: stale driver cutoff (minutes) ---
      let ageMin = 0;
      try {
        const tsRaw = (d?.updated_at ?? d?.updatedAt ?? null);
        if (tsRaw) {
          const ts = new Date(tsRaw);
          const now = Date.now();
          ageMin = (now - ts.getTime()) / 60000;
        }
      } catch {
        ageMin = 0;
      }

      if (ageMin > $StaleMinutes) {
        // stale -> skip rendering marker
        continue;
      }
      // --- end stale cutoff ---
"@

$txt2 = $rx.Replace($txt, $inject, 1)

Write-TextUtf8NoBom $mapPath $txt2
Ok ("[OK] Patched stale cutoff into fleet markers: {0}" -f $mapPath)

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