<# 
PATCH-JRIDE_LIVETRIPS_DRIVER_DIAG_AND_LOADDRIVERS_FIX_V5_PS5SAFE.ps1

What it does (targeted + diagnostic-first):
1) Replaces loadDrivers() with PS5-safe robust parsing:
   - Supports { ok:true, rows:[...] } (driver_locations)
   - Avoids JS truthy bug: [] || [] returning empty
   - Removes the known-404 endpoint "/api/driver-locations" to stop console spam

2) Injects an on-page debug line under "Drivers: {driversDebug}" showing:
   - drivers.length
   - first driver_id sample (driver_id/driverId/id)
   - keys of the first driver object

This lets you SEE why dropdown is empty before any further patches.

PS5-safe. UTF-8 no BOM. Creates timestamp backup.
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Info([string]$m) { Write-Host $m -ForegroundColor Cyan }
function Ok([string]$m)   { Write-Host $m -ForegroundColor Green }
function Warn([string]$m) { Write-Host $m -ForegroundColor Yellow }
function Fail([string]$m) { Write-Host $m -ForegroundColor Red; throw $m }

function Normalize-Path([string]$p) {
  try { return (Resolve-Path -LiteralPath $p).Path } catch { return $p }
}

function Read-TextUtf8NoBom([string]$path) {
  if (!(Test-Path -LiteralPath $path)) { Fail "File not found: $path" }
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $bytes = $bytes[3..($bytes.Length-1)]
  }
  return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Write-TextUtf8NoBom([string]$path, [string]$text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

function Backup-File([string]$path, [string]$tag) {
  $dir = Split-Path -Parent $path
  $name = Split-Path -Leaf $path
  $stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
  $bak = Join-Path $dir ("{0}.bak.{1}.{2}" -f $name, $tag, $stamp)
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Ok ("[OK] Backup: {0}" -f $bak)
  return $bak
}

function Find-Function-Range([string]$text) {
  $needles = @("async function loadDrivers", "function loadDrivers")
  $idx = -1
  $needleUsed = $null
  foreach ($n in $needles) {
    $idx = $text.IndexOf($n, [System.StringComparison]::Ordinal)
    if ($idx -ge 0) { $needleUsed = $n; break }
  }
  if ($idx -lt 0) { return $null }

  $braceOpen = $text.IndexOf("{", $idx)
  if ($braceOpen -lt 0) { return $null }

  $depth = 0
  $end = -1
  for ($i = $braceOpen; $i -lt $text.Length; $i++) {
    $ch = $text[$i]
    if ($ch -eq "{") { $depth++ }
    elseif ($ch -eq "}") {
      $depth--
      if ($depth -eq 0) { $end = $i; break }
    }
  }
  if ($end -lt 0) { return $null }

  return @{ Start=$idx; End=$end; Needle=$needleUsed }
}

Info "== JRIDE LiveTrips: driver diag + loadDrivers fix (V5 / PS5-safe) =="

$ProjRoot = Normalize-Path $ProjRoot
Info ("Repo: {0}" -f $ProjRoot)

$target = Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx"
$target = Normalize-Path $target
Info ("Target: {0}" -f $target)

if (!(Test-Path -LiteralPath $target)) {
  Fail "Target file not found. Expected: $target"
}

$content = Read-TextUtf8NoBom $target

# --- 1) Replace loadDrivers() ---
$range = Find-Function-Range $content
if ($null -eq $range) {
  Fail "Could not find/parse loadDrivers() function block in LiveTripsClient.tsx"
}
Info ("Found loadDrivers() via: {0}" -f $range.Needle)

$replacement = @'
async function loadDrivers() {
    // Diagnostic-safe, robust parsing. Avoids the JS "[] || []" truthy empty-array bug.
    // Also removes known-404 endpoint "/api/driver-locations" (hyphen) to stop console spam.
    const endpoints = [
      "/api/admin/driver-locations",
      "/api/admin/driver_locations",
      "/api/admin/drivers",
      "/api/driver_locations",
    ];

    const pickFirstNonEmpty = <T,>(cands: any[]): T[] => {
      for (const c of cands) {
        if (Array.isArray(c) && c.length) return c as T[];
      }
      return [];
    };

    for (const url of endpoints) {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) continue;

        const j: any = await r.json().catch(() => ({} as any));

        const arr = pickFirstNonEmpty<DriverRow>([
          j.rows,     // { ok:true, rows:[...] }
          j.drivers,
          j.data,
          j.items,
          j["0"],
          Array.isArray(j) ? j : null,
        ]);

        if (arr.length) {
          setDrivers(arr);
          setDriversDebug(`loaded from ${url} (${arr.length})`);
          return;
        }
      } catch {
        // try next endpoint
      }
    }

    setDrivers([]);
    setDriversDebug("No drivers loaded from known endpoints (check RLS / endpoint path).");
  }
'@

Backup-File $target "LIVETRIPS_DRIVER_DIAG_AND_LOADDRIVERS_FIX_V5" | Out-Null

$start = [int]$range.Start
$end   = [int]$range.End
$before = $content.Substring(0, $start)
$after  = $content.Substring($end + 1)
$newContent = $before + $replacement + $after

# --- 2) Inject on-page diagnostics under driversDebug line ---
$needle1 = 'Drivers: {driversDebug}'
$insert = @'
Drivers: {driversDebug}
              <div className="mt-1 text-[11px] text-gray-500">
                diag: driversLen={drivers.length} firstId={String((drivers[0] as any)?.driver_id || (drivers[0] as any)?.driverId || (drivers[0] as any)?.id || "")} keys={drivers[0] ? Object.keys(drivers[0] as any).join(",") : ""}
              </div>
'@

if ($newContent -notmatch [regex]::Escape($needle1)) {
  Warn "[WARN] Could not find the exact 'Drivers: {driversDebug}' line for debug injection. loadDrivers patch still applied."
} else {
  # Replace only the first occurrence
  $idx = $newContent.IndexOf($needle1, [System.StringComparison]::Ordinal)
  if ($idx -ge 0) {
    $newContent = $newContent.Substring(0, $idx) + $insert + $newContent.Substring($idx + $needle1.Length)
    Ok "[OK] Injected on-page driver diagnostics under Drivers debug line"
  }
}

Write-TextUtf8NoBom $target $newContent
Ok "[OK] Patched LiveTripsClient.tsx (loadDrivers + on-page diag)"
Info "Done."