# PATCH-JRIDE_DRIVER_LOC_WRITE_ROUTES_V1.ps1
# Fixes WRITE routes that upsert driver_locations to match actual schema:
# driver_id, town, status, lat, lng, updated_at
# Rewrites:
# - app/api/driver-heartbeat/route.ts
# - app/api/live-location/route.ts
# Safe: backups + full-file rewrite (small routes), no schema assumptions beyond proven columns.

$ErrorActionPreference = "Stop"
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }

$root = Get-Location

$hbPath   = Join-Path $root "app\api\driver-heartbeat\route.ts"
$livePath = Join-Path $root "app\api\live-location\route.ts"

if (!(Test-Path $hbPath))   { Fail "Missing: $hbPath" }
if (!(Test-Path $livePath)) { Fail "Missing: $livePath" }

$ts = Stamp
Copy-Item $hbPath   "$hbPath.bak.$ts" -Force
Copy-Item $livePath "$livePath.bak.$ts" -Force
Write-Host "[OK] Backup: $hbPath.bak.$ts"
Write-Host "[OK] Backup: $livePath.bak.$ts"

$commonHelpers = @'
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

function asNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function norm(s: any): string {
  return String(s ?? "").trim().toLowerCase();
}

// Very lightweight Ifugao town derivation (same bounds style you already use elsewhere)
function deriveTownFromLatLng(lat: number, lng: number): string | null {
  const BOXES: Array<{ name: string; minLat: number; maxLat: number; minLng: number; maxLng: number }> = [
    { name: "Lagawe",  minLat: 17.05, maxLat: 17.16, minLng: 121.10, maxLng: 121.30 },
    { name: "Kiangan", minLat: 16.98, maxLat: 17.10, minLng: 121.05, maxLng: 121.25 },
    { name: "Lamut",   minLat: 16.86, maxLat: 17.02, minLng: 121.10, maxLng: 121.28 },
    { name: "Hingyon", minLat: 17.10, maxLat: 17.22, minLng: 121.00, maxLng: 121.18 },
    { name: "Banaue",  minLat: 16.92, maxLat: 17.15, minLng: 121.02, maxLng: 121.38 },
  ];
  for (const b of BOXES) {
    if (lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng) return b.name;
  }
  return null;
}
'@

# -------------------------
# Rewrite /api/live-location (driverId, lat, lng, status)
# -------------------------
$liveNew = $commonHelpers + @'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const driverId = String(body?.driverId ?? body?.driver_id ?? "").trim();
    const lat = asNum(body?.lat);
    const lng = asNum(body?.lng);

    if (!driverId || lat == null || lng == null) {
      return NextResponse.json(
        { ok: false, error: "driverId/driver_id, lat, lng required", got: { driverId, lat, lng } },
        { status: 400 }
      );
    }

    const statusRaw = body?.status ?? body?.state ?? "online";
    const status = norm(statusRaw) === "offline" ? "offline" : "online";

    const townRaw = body?.town ?? null;
    const town = townRaw ? String(townRaw) : deriveTownFromLatLng(lat, lng);

    // Upsert to proven schema columns
    const { error } = await supabaseServer
      .from("driver_locations")
      .upsert(
        { driver_id: driverId, lat, lng, status, town },
        { onConflict: "driver_id" }
      );

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, data: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
'@

# -------------------------
# Rewrite /api/driver-heartbeat (driver_id, lat, lng, is_available)
# -------------------------
$hbNew = $commonHelpers + @'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const driverId = String(body?.driver_id ?? body?.driverId ?? body?.driver_id ?? "").trim();
    const lat = asNum(body?.lat);
    const lng = asNum(body?.lng);

    if (!driverId || lat == null || lng == null) {
      return NextResponse.json(
        { ok: false, error: "driver_id/driverId, lat, lng required", got: { driverId, lat, lng } },
        { status: 400 }
      );
    }

    const isAvail = body?.is_available === undefined ? true : !!body?.is_available;
    const status = isAvail ? "online" : "offline";

    const townRaw = body?.town ?? null;
    const town = townRaw ? String(townRaw) : deriveTownFromLatLng(lat, lng);

    const { error } = await supabaseServer
      .from("driver_locations")
      .upsert(
        { driver_id: driverId, lat, lng, status, town },
        { onConflict: "driver_id" }
      );

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
'@

Set-Content -LiteralPath $livePath -Value $liveNew -Encoding UTF8
Set-Content -LiteralPath $hbPath   -Value $hbNew   -Encoding UTF8

Write-Host "[DONE] Rewrote:"
Write-Host " - $livePath"
Write-Host " - $hbPath"
Write-Host "[NEXT] npm.cmd run build"
