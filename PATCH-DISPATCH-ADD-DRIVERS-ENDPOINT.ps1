# PATCH-DISPATCH-ADD-DRIVERS-ENDPOINT.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"

$src = Join-Path $root "app\api\admin\driver_locations\route.ts"
if (!(Test-Path $src)) { Fail "Source route not found: $src" }

$dstDir = Join-Path $root "app\api\dispatch\drivers"
$dst = Join-Path $dstDir "route.ts"

if (!(Test-Path $dstDir)) {
  New-Item -ItemType Directory -Path $dstDir | Out-Null
}

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
if (Test-Path $dst) {
  Copy-Item $dst "$dst.bak.$ts" -Force
}

$code = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

/**
 * Dispatch-safe driver feed
 * - One row per driver (latest location)
 * - Online / available drivers only
 * - Minimal fields (no LiveTrips coupling)
 */
export async function GET() {
  const { data, error } = await supabase
    .from("driver_locations")
    .select(`
      driver_id,
      driver_name,
      town,
      status,
      lat,
      lng,
      updated_at
    `)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  // Deduplicate: latest location per driver
  const seen = new Set<string>();
  const drivers = [];

  for (const row of data || []) {
    if (!row.driver_id) continue;
    if (seen.has(row.driver_id)) continue;

    seen.add(row.driver_id);

    if (row.status && !["online", "available"].includes(String(row.status).toLowerCase())) {
      continue;
    }

    drivers.push({
      id: row.driver_id,
      name: row.driver_name ?? null,
      town: row.town ?? null,
      status: row.status ?? "online",
      lat: row.lat,
      lng: row.lng,
      last_seen: row.updated_at,
    });
  }

  return NextResponse.json({ ok: true, drivers });
}
'@

Set-Content -Path $dst -Value $code -Encoding UTF8
Write-Host "[OK] Created /api/dispatch/drivers endpoint" -ForegroundColor Green
Write-Host " -> $dst" -ForegroundColor DarkGray

Write-Host ""
Write-Host "Test with:" -ForegroundColor Cyan
Write-Host "Invoke-RestMethod http://localhost:3000/api/dispatch/drivers" -ForegroundColor Cyan
