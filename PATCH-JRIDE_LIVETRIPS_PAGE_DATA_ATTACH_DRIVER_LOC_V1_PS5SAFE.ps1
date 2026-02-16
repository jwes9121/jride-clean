param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

Write-Host "== PATCH: LiveTrips page-data attach driver_locations to trips (V1 / PS5-safe) =="

$target = Join-Path $ProjRoot "app\api\admin\livetrips\page-data\route.ts"
if (!(Test-Path -LiteralPath $target)) { throw "Target not found: $target" }

$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("livetrips-page-data.route.ts.bak.DRIVERLOC_V1.{0}" -f $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

# Read UTF-8 safely
$src = Get-Content -LiteralPath $target -Raw

# Anchor: insert enrichment block right before "const tripsOut ="
$anchor = "const tripsOut ="
if ($src.IndexOf($anchor) -lt 0) {
  throw "Could not find anchor: $anchor"
}

$inject = @'
  // ===== JRIDE_DRIVERLOC_ENRICH_BEGIN =====
  // Attach latest driver location to trips so UI/map can show driver marker and avoid false "no driver linked".
  try {
    const ids = Array.from(
      new Set(
        (Array.isArray(trips) ? trips : [])
          .map((t: any) => (t?.assigned_driver_id ?? t?.driver_id ?? null))
          .filter((v: any) => v != null && String(v).trim() !== "")
          .map((v: any) => String(v))
      )
    );

    if (ids.length) {
      const { data: locRows, error: locErr } = await supabase
        .from("driver_locations")
        .select("driver_id, lat, lng, status, town, updated_at")
        .in("driver_id", ids)
        .order("updated_at", { ascending: false })
        .limit(1000);

      if (locErr) {
        console.error("LIVETRIPS_DRIVERLOC_QUERY_ERROR", locErr);
      } else if (Array.isArray(locRows) && locRows.length) {
        const latestByDriver = new Map<string, any>();
        for (const r of locRows as any[]) {
          const did = r?.driver_id != null ? String(r.driver_id) : "";
          if (!did) continue;
          if (!latestByDriver.has(did)) latestByDriver.set(did, r); // first is latest due to order desc
        }

        for (const t of (Array.isArray(trips) ? trips : []) as any[]) {
          const did = t?.assigned_driver_id ?? t?.driver_id ?? null;
          if (!did) continue;
          const loc = latestByDriver.get(String(did));
          if (!loc) continue;

          // These fields are what LiveTripsMap checks first (explicit driver coords)
          t.driver_lat = loc.lat ?? null;
          t.driver_lng = loc.lng ?? null;

          // Extra context for UI if needed later
          t.driver_loc_status = loc.status ?? null;
          t.driver_loc_town = loc.town ?? null;
          t.driver_loc_updated_at = loc.updated_at ?? null;
        }
      }
    }
  } catch (e: any) {
    console.error("LIVETRIPS_DRIVERLOC_ENRICH_EXCEPTION", e?.message || e);
  }
  // ===== JRIDE_DRIVERLOC_ENRICH_END =====

'@

# Insert inject BEFORE anchor
$idx = $src.IndexOf($anchor)
$patched = $src.Substring(0, $idx) + $inject + $src.Substring($idx)

# Write UTF-8 no BOM (PS5-safe)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $patched, $utf8NoBom)

Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "NEXT: redeploy, then open:"
Write-Host "  https://app.jride.net/api/admin/livetrips/page-data?debug=1"
Write-Host "  https://app.jride.net/admin/livetrips"
