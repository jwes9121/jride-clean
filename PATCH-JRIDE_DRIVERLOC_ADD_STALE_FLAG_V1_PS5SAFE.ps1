param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"
Write-Host "== PATCH JRIDE: driver_locations API adds stale flag + age_seconds (V1 / PS5-safe) =="

$target = Join-Path $ProjRoot "app\api\driver_locations\route.ts"
if (!(Test-Path -LiteralPath $target)) { throw "Target not found: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir ("route.ts.bak.DRIVERLOC_STALE_V1.$stamp")
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $target -Raw

# Idempotent guard
if ($txt -match "is_stale" -and $txt -match "age_seconds") {
  Write-Host "[WARN] route.ts already appears to include stale fields. Skipping."
  exit 0
}

# Insert constants near top (after createClient line if possible)
if ($txt -notmatch "const STALE_AFTER_SECONDS") {
  $insPoint = $txt.IndexOf("export async function GET()")
  if ($insPoint -lt 0) { throw "Could not locate 'export async function GET()'." }

  $constBlock = @'
const STALE_AFTER_SECONDS = 120; // 2 minutes
'@

  $txt = $txt.Insert($insPoint, $constBlock + "`r`n")
  Write-Host "[OK] Inserted STALE_AFTER_SECONDS constant."
}

# Replace the normalized mapping block
$needleStart = "const normalized = (Array.isArray(data) ? data : []).map((r: any) => {"
$idx = $txt.IndexOf($needleStart)
if ($idx -lt 0) { throw "Could not locate normalized mapping block." }

# Find end of that block by locating the next '});' after idx
$endIdx = $txt.IndexOf("});", $idx)
if ($endIdx -lt 0) { throw "Could not locate end of normalized mapping block (});)." }
$endIdx = $endIdx + 3

$newBlock = @'
const normalized = (Array.isArray(data) ? data : []).map((r: any) => {
    const town = (r?.town ?? r?.home_town ?? null);

    // Staleness: view shows last 10 minutes; mark stale after 2 minutes.
    const updatedAt = r?.updated_at ? new Date(String(r.updated_at)) : null;
    const ageSeconds =
      updatedAt && !isNaN(updatedAt.getTime())
        ? Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / 1000))
        : null;

    const isStale = typeof ageSeconds === "number" ? ageSeconds > STALE_AFTER_SECONDS : true;

    // keep original fields, but ensure town is populated when possible
    return { ...r, town, age_seconds: ageSeconds, is_stale: isStale };
  });
'@

$txt = $txt.Substring(0, $idx) + $newBlock + $txt.Substring($endIdx)
Write-Host "[OK] Patched normalized mapping to include age_seconds + is_stale."

# Also include stale_after_seconds in response payload (so UI can display threshold if needed later)
$txt = $txt -replace '\{\s*ok:\s*true,\s*drivers:\s*normalized\s*\}', '{ ok: true, stale_after_seconds: STALE_AFTER_SECONDS, drivers: normalized }'

Set-Content -LiteralPath $target -Value $txt -Encoding UTF8
Write-Host "[OK] Wrote: $target"
Write-Host "Done."