<# 
PATCH-JRIDE_LIVETRIPS_LOADDRIVERS_MERGE_ENDPOINTS_V4_PS5SAFE.ps1

Fix: LiveTrips not showing online drivers that exist in one endpoint but not the other.
Cause: loadDrivers() stops at first non-empty endpoint; if that endpoint excludes a driver, UI never sees them.

Solution:
- Fetch ALL known endpoints
- Merge/union rows by driver_id
- Prefer the row with the freshest updated_at/last_seen_at
- Normalize fields into the shape LiveTrips expects
- PS5-safe, UTF-8 no BOM, timestamp backup
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

Info "== JRIDE LiveTrips: loadDrivers merge endpoints (V4 / PS5-safe) =="

$ProjRoot = Normalize-Path $ProjRoot
Info ("Repo: {0}" -f $ProjRoot)

$target = Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx"
$target = Normalize-Path $target
Info ("Target: {0}" -f $target)

if (!(Test-Path -LiteralPath $target)) {
  Fail "Target file not found. Expected: $target"
}

$content = Read-TextUtf8NoBom $target

$range = Find-Function-Range $content
if ($null -eq $range) {
  Fail "Could not find/parse loadDrivers() function block in LiveTripsClient.tsx"
}
Info ("Found loadDrivers() via: {0}" -f $range.Needle)

# Replacement loadDrivers() (ASCII-only)
$replacement = @'
async function loadDrivers() {
    // Merge drivers from multiple endpoints (hyphen and underscore variants).
    // Some deployments return different subsets; union by driver_id and keep freshest timestamps.
    const endpoints = [
      "/api/admin/driver-locations",
      "/api/admin/driver_locations",
      "/api/admin/drivers",
      "/api/driver-locations",
      "/api/driver_locations",
    ];

    const pickArray = (j: any): any[] => {
      if (!j) return [];
      if (Array.isArray(j.rows)) return j.rows;
      if (Array.isArray(j.drivers)) return j.drivers;
      if (Array.isArray(j.data)) return j.data;
      if (Array.isArray(j.items)) return j.items;
      if (Array.isArray(j["0"])) return j["0"];
      if (Array.isArray(j)) return j;
      return [];
    };

    const toMs = (v: any): number => {
      if (!v) return 0;
      const t = Date.parse(String(v));
      return Number.isFinite(t) ? t : 0;
    };

    const normalize = (d: any) => ({
      driver_id: d?.driver_id ?? d?.driverId ?? d?.id ?? null,
      name: d?.name ?? d?.driver_name ?? d?.driverName ?? null,
      phone: d?.phone ?? d?.driver_phone ?? d?.driverPhone ?? null,
      town: d?.town ?? d?.zone ?? d?.zone_name ?? d?.home_town ?? d?.homeTown ?? null,
      status: d?.status ?? d?.driver_status ?? null,
      lat: d?.lat ?? d?.latitude ?? d?.driver_lat ?? d?.driverLat ?? null,
      lng: d?.lng ?? d?.longitude ?? d?.driver_lng ?? d?.driverLng ?? null,
      updated_at: d?.updated_at ?? d?.last_seen_at ?? d?.lastSeenAt ?? null,
      last_seen_at: d?.last_seen_at ?? d?.lastSeenAt ?? null,
      vehicle_type: d?.vehicle_type ?? d?.vehicleType ?? null,
      capacity: d?.capacity ?? null,
      _ms: Math.max(toMs(d?.updated_at), toMs(d?.last_seen_at), toMs(d?.lastSeenAt)),
    });

    const merged: Record<string, any> = {};
    const sourcesOk: string[] = [];
    const sourcesTried: string[] = [];

    for (const url of endpoints) {
      sourcesTried.push(url);
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) continue;
        const j: any = await r.json().catch(() => ({} as any));
        const arr = pickArray(j);
        if (!arr.length) continue;

        sourcesOk.push(url);

        for (const raw of arr) {
          const d = normalize(raw);
          const id = d.driver_id ? String(d.driver_id) : "";
          if (!id) continue;

          const prev = merged[id];
          if (!prev) {
            merged[id] = d;
          } else {
            // keep the freshest timestamp; if tie, prefer "online"
            const prevMs = prev._ms || 0;
            const curMs = d._ms || 0;
            if (curMs > prevMs) merged[id] = d;
            else if (curMs === prevMs) {
              const prevOn = String(prev.status || "").toLowerCase() === "online";
              const curOn = String(d.status || "").toLowerCase() === "online";
              if (curOn && !prevOn) merged[id] = d;
            }
          }
        }
      } catch {
        // ignore and continue
      }
    }

    const list = Object.values(merged)
      .map((d: any) => {
        // strip helper field
        const { _ms, ...rest } = d;
        return rest;
      })
      .filter((d: any) => !!d.driver_id);

    setDrivers(list as any);
    setDriversDebug(`loaded from ${sourcesOk.join(", ")} (${list.length})`);
  }
'@

Backup-File $target "LIVETRIPS_LOADDRIVERS_MERGE_V4" | Out-Null

$start = [int]$range.Start
$end   = [int]$range.End

$before = $content.Substring(0, $start)
$after  = $content.Substring($end + 1)

$newContent = $before + $replacement + $after

Write-TextUtf8NoBom $target $newContent
Ok ("[OK] Replaced loadDrivers() block Start={0} End={1}" -f $start, $end)

Info "Done."