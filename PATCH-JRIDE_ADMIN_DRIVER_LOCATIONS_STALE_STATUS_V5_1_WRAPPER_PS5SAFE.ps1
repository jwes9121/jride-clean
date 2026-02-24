# PATCH-JRIDE_ADMIN_DRIVER_LOCATIONS_STALE_STATUS_V5_1_WRAPPER_PS5SAFE.ps1
# Purpose:
# - Fix TS error: BaseGET expects 0 args, but wrapper called BaseGET(req).
# - Update wrapper to call BaseGET() with NO args.
# - Keep stale normalization behavior.
# - Runs: npm.cmd run build
#
# PS5-safe, backups included, ASCII-only, UTF-8 no BOM.

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

function Ensure-Dir([string]$p) { if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null } }
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

function Has-NonAscii([string]$s) {
  foreach ($ch in $s.ToCharArray()) { if ([int][char]$ch -gt 127) { return $true } }
  return $false
}

Info "== JRIDE Patch: admin driver_locations wrapper call fix (V5.1 / PS5-safe) =="
$root = (Resolve-Path -LiteralPath $ProjRoot).Path
Info ("Repo: {0}" -f $root)
Info ("StaleMinutes: {0}" -f $StaleMinutes)

$target = Join-Path $root "app\api\admin\driver_locations\route.ts"
if (-not (Test-Path -LiteralPath $target)) {
  Fail ("[FAIL] Target route not found: {0}" -f $target)
}

$bakDir = Join-Path $root "_patch_bak"
Backup-File $target $bakDir "ADMIN_DRIVER_LOCATIONS_STALE_V5_1"

$txt = Read-TextUtf8NoBom $target

# Extract moduleSpec from current wrapper import line:
# import { GET as BaseGET } from "<moduleSpec>";
$rxMod = New-Object System.Text.RegularExpressions.Regex(
  'import\s*\{\s*GET\s+as\s+BaseGET\s*\}\s*from\s*"(?<m>[^"]+)"\s*;',
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)
$m = $rxMod.Match($txt)
if (-not $m.Success) {
  Fail "[FAIL] Could not find BaseGET import in current wrapper. (Expected: import { GET as BaseGET } from \"...\";)"
}
$moduleSpec = $m.Groups["m"].Value.Trim()

# Rebuild wrapper with BaseGET() call (no args)
$wrapper = @"
import { NextResponse } from "next/server";
import { GET as BaseGET } from "$moduleSpec";

function normalizeDrivers(list: any, staleMinutes: number) {
  const arr = Array.isArray(list) ? list : [];
  const nowMs = Date.now();
  return arr.map((r: any) => {
    let ageMin = 0;
    try {
      const tsRaw = (r?.updated_at ?? r?.updatedAt ?? null);
      if (tsRaw) {
        const ts = new Date(tsRaw);
        ageMin = (nowMs - ts.getTime()) / 60000;
      }
    } catch {
      ageMin = 0;
    }
    const isStale = ageMin > staleMinutes;
    const originalStatus = (r?.status ?? "unknown");
    const effectiveStatus = (isStale ? "stale" : originalStatus);
    return {
      ...r,
      age_min: Math.round(ageMin * 10) / 10,
      is_stale: isStale,
      effective_status: effectiveStatus,
      status: effectiveStatus,
    };
  });
}

export async function GET(_req: Request) {
  // BaseGET in this codebase expects 0 args (it closes over request context / auth internally)
  const res: any = await BaseGET();

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    return res;
  }

  const staleMinutes = $StaleMinutes;

  if (data && typeof data === "object") {
    if (Object.prototype.hasOwnProperty.call(data, "drivers")) {
      data.drivers = normalizeDrivers(data.drivers, staleMinutes);
    }
    if (Object.prototype.hasOwnProperty.call(data, "driver_locations")) {
      data.driver_locations = normalizeDrivers(data.driver_locations, staleMinutes);
    }
  }

  return NextResponse.json(data, { status: (res?.status ?? 200) });
}
"@

if (Has-NonAscii $wrapper) {
  Fail "[FAIL] Wrapper content unexpectedly contains non-ASCII characters."
}

Write-TextUtf8NoBom $target $wrapper
Ok ("[OK] Updated wrapper to call BaseGET() with no args: {0}" -f $target)

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