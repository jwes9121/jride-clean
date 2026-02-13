# PHASE4_ADD_DRIVER_LOCATION_PING_ENDPOINT.ps1
# Phase 4: Add driver heartbeat endpoint to keep public.driver_locations.updated_at fresh
# Creates:
#   app\api\driver\location\ping\route.ts
#   TEST-DRIVER-LOCATION-PING.ps1
# Then:
#   npm.cmd run build
#   git commit + tag

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

# Sanity: run from repo root
if (!(Test-Path "package.json")) { Fail "Run from repo root (package.json not found)." }

$target = "app\api\driver\location\ping\route.ts"
$dir = Split-Path -Parent $target
New-Item -ItemType Directory -Force -Path $dir | Out-Null

if (Test-Path $target) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  Copy-Item $target "$target.bak.$stamp" -Force
  Write-Host "[OK] Backup: $target.bak.$stamp"
}

$route = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function envAny(names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function json(status: number, obj: any) {
  return NextResponse.json(obj, { status });
}

function num(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

// Optional shared secret (recommended in prod)
// If DRIVER_PING_SECRET is set, request must include header: x-jride-ping-secret: <secret>
function checkSecret(req: Request) {
  const secret = envAny(["DRIVER_PING_SECRET"]);
  if (!secret) return true; // no secret configured -> allow (dev-friendly)
  const got = req.headers.get("x-jride-ping-secret") || "";
  return got === secret;
}

export async function GET() {
  // quick health check
  return json(200, { ok: true, route: "driver/location/ping" });
}

export async function POST(req: Request) {
  try {
    if (!checkSecret(req)) {
      return json(401, { ok: false, code: "UNAUTHORIZED", message: "Missing/invalid x-jride-ping-secret" });
    }

    const SUPABASE_URL = envAny(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
    const SERVICE_KEY = envAny(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE"]);

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(500, { ok: false, code: "MISSING_ENV", message: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }

    const body = await req.json().catch(() => ({} as any));

    const driver_id = str(body.driver_id ?? body.driverId ?? body.driver_uuid ?? body.driverUuid);
    const lat = num(body.lat ?? body.latitude);
    const lng = num(body.lng ?? body.longitude);
    const status = str(body.status ?? body.driver_status ?? body.driverStatus);
    const town = str(body.town ?? body.zone);

    if (!driver_id) {
      return json(400, { ok: false, code: "BAD_REQUEST", message: "driver_id is required" });
    }

    // lat/lng can be optional if the app pings status only, but usually required
    // we won't hard-fail if missing; we'll just not overwrite lat/lng.
    const patch: any = {
      updated_at: new Date().toISOString(),
    };
    if (lat != null) patch.lat = lat;
    if (lng != null) patch.lng = lng;
    if (status) patch.status = status;
    if (town) patch.town = town;

    // pass-through optional fields if provided (schema-flex; harmless if columns exist)
    const vehicle_type = str(body.vehicle_type ?? body.vehicleType);
    const capacity = body.capacity != null ? Number(body.capacity) : null;
    const home_town = str(body.home_town ?? body.homeTown);
    if (vehicle_type) patch.vehicle_type = vehicle_type;
    if (Number.isFinite(capacity as any)) patch.capacity = capacity;
    if (home_town) patch.home_town = home_town;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) Try UPSERT by driver_id (requires unique constraint on driver_id)
    // If that fails due to missing unique constraint, fallback to update-or-insert.
    const upsertPayload = { driver_id, ...patch };

    let upsertErr: any = null;
    try {
      const { error } = await supabase
        .from("driver_locations")
        .upsert(upsertPayload, { onConflict: "driver_id" });
      if (error) upsertErr = error;
    } catch (e: any) {
      upsertErr = e;
    }

    if (!upsertErr) {
      return json(200, { ok: true, driver_id, updated_at: patch.updated_at, mode: "upsert(driver_id)" });
    }

    // 2) Fallback path (schema-flex): update existing row (if any), else insert
    // We do NOT assume constraints; we probe.
    const { data: existing, error: selErr } = await supabase
      .from("driver_locations")
      .select("id, driver_id")
      .eq("driver_id", driver_id)
      .limit(1);

    if (!selErr && Array.isArray(existing) && existing.length > 0 && existing[0]?.id) {
      const id = existing[0].id;
      const { error: updErr } = await supabase
        .from("driver_locations")
        .update(patch)
        .eq("id", id);

      if (updErr) {
        return json(500, {
          ok: false,
          code: "UPDATE_FAILED",
          message: updErr.message || "Update failed",
          detail: { upsert_error: (upsertErr as any)?.message || String(upsertErr) },
        });
      }

      return json(200, { ok: true, driver_id, updated_at: patch.updated_at, mode: "update(id)" });
    }

    // insert new row (assumes id has default; if not, Supabase will error and we surface it)
    const { error: insErr } = await supabase
      .from("driver_locations")
      .insert(upsertPayload);

    if (insErr) {
      return json(500, {
        ok: false,
        code: "INSERT_FAILED",
        message: insErr.message || "Insert failed",
        detail: {
          upsert_error: (upsertErr as any)?.message || String(upsertErr),
          select_error: selErr?.message || null,
        },
      });
    }

    return json(200, { ok: true, driver_id, updated_at: patch.updated_at, mode: "insert(driver_id)" });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: e?.message || "ping failed" });
  }
}
'@

Set-Content -LiteralPath $target -Value $route -Encoding UTF8
Write-Host "[OK] Wrote route: $target"

# Create a quick local test script (adjust driver_id + port as needed)
$test = @'
# TEST-DRIVER-LOCATION-PING.ps1
# Sends a heartbeat ping to your local server (npm run dev must be running)

param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$DriverId = "PASTE_DRIVER_UUID_HERE",
  [double]$Lat = 16.829,
  [double]$Lng = 121.115,
  [string]$Status = "online",
  [string]$Town = "Lagawe",
  [string]$PingSecret = ""
)

$uri = "$BaseUrl/api/driver/location/ping"

$headers = @{ "Content-Type" = "application/json" }
if ($PingSecret) { $headers["x-jride-ping-secret"] = $PingSecret }

$body = @{
  driver_id = $DriverId
  lat = $Lat
  lng = $Lng
  status = $Status
  town = $Town
} | ConvertTo-Json

Write-Host "POST $uri"
Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body
'@

Set-Content -LiteralPath ".\TEST-DRIVER-LOCATION-PING.ps1" -Value $test -Encoding UTF8
Write-Host "[OK] Wrote test script: TEST-DRIVER-LOCATION-PING.ps1"

Write-Host ""
Write-Host "[STEP] npm.cmd run build"
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { Fail "Build failed. Not committing." }

Write-Host ""
Write-Host "[STEP] git add -A"
& git add -A

Write-Host "[STEP] git commit"
& git commit -m "JRIDE_PHASE4 add driver location ping heartbeat endpoint"

$tag = "JRIDE_PHASE4_PING_ENDPOINT_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Write-Host "[STEP] git tag $tag"
& git tag $tag

Write-Host ""
Write-Host "[DONE] Commit + tag created:"
Write-Host "  $tag"
Write-Host ""
Write-Host "Next push:"
Write-Host "  git push"
Write-Host "  git push --tags"
