# PATCH-DISPATCH-DRIVERS-PHASE1-LIVE-LOADER.ps1
# Adds /api/dispatch/drivers-live route + loadDriversLive() wired into dispatch refresh loop.
# Reversible: creates timestamped backups + marker blocks.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Ok($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }

$root = (Get-Location).Path

$uiPath = Join-Path $root "app\dispatch\page.tsx"
if (!(Test-Path $uiPath)) { Fail "Missing file: $uiPath" }

$apiPath = Join-Path $root "app\api\dispatch\drivers-live\route.ts"
$apiDir  = Split-Path -Parent $apiPath
if (!(Test-Path $apiDir)) { New-Item -ItemType Directory -Force -Path $apiDir | Out-Null }

$ts = Get-Date -Format "yyyyMMdd-HHmmss"

# --- Backup UI
$uiBak = "$uiPath.bak.$ts"
Copy-Item $uiPath $uiBak -Force
Ok "Backup UI: app\dispatch\page.tsx.bak.$ts"

# --- Write API route (safe overwrite with backup if exists)
if (Test-Path $apiPath) {
  $apiBak = "$apiPath.bak.$ts"
  Copy-Item $apiPath $apiBak -Force
  Ok "Backup API: app\api\dispatch\drivers-live\route.ts.bak.$ts"
}

$apiContent = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function env(name: string) {
  return process.env[name] || "";
}

export async function GET() {
  try {
    const url =
      env("SUPABASE_URL") ||
      env("NEXT_PUBLIC_SUPABASE_URL");

    const key =
      env("SUPABASE_SERVICE_ROLE_KEY") ||
      env("SUPABASE_SERVICE_ROLE") ||
      env("SUPABASE_ANON_KEY") ||
      env("NEXT_PUBLIC_SUPABASE_ANON_KEY");

    if (!url || !key) {
      return NextResponse.json(
        { ok: false, code: "MISSING_SUPABASE_ENV", message: "Missing SUPABASE URL/KEY env vars." },
        { status: 500 }
      );
    }

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Primary source (recommended): mv_driver_live
    // Expected columns (based on your schema snapshots):
    // id, driver_name, driver_status, wallet_balance, min_wallet_required, wallet_locked, lat, lng, location_updated_at
    const { data, error } = await supabase
      .from("mv_driver_live")
      .select("id, driver_name, driver_status, wallet_balance, min_wallet_required, wallet_locked, lat, lng, location_updated_at, updated_at")
      .limit(2000);

    if (error) {
      return NextResponse.json(
        { ok: false, code: "SUPABASE_QUERY_FAILED", message: error.message, hint: "Ensure mv_driver_live is accessible via RLS/service key." },
        { status: 500 }
      );
    }

    const map: Record<string, any> = {};
    for (const d of data || []) {
      const id = String((d as any).id || "");
      if (!id) continue;
      map[id] = d;
    }

    return NextResponse.json({ ok: true, drivers: map }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, code: "UNHANDLED", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}
'@

Set-Content -Path $apiPath -Value $apiContent -Encoding UTF8
Ok "Wrote API: app\api\dispatch\drivers-live\route.ts"

# --- Patch UI: insert loadDriversLive() and wire into refresh loop
$txt = Get-Content $uiPath -Raw -Encoding UTF8

if ($txt -match "JRIDE_UI_DRIVER_HEALTH_LOADER_START") {
  Fail "Driver Health loader already exists (JRIDE_UI_DRIVER_HEALTH_LOADER_START). Aborting."
}

# Anchor: async function loadObs() { ... }
$rxLoadObs = '(?s)(async function\s+loadObs\s*\(\)\s*\{\s*.*?\n\})'
$m = [regex]::Match($txt, $rxLoadObs)
if (!$m.Success) { Fail "Could not find anchor: async function loadObs() { ... }" }

$loaderBlock = @'

  /* JRIDE_UI_DRIVER_HEALTH_LOADER_START */
  async function loadDriversLive() {
    try {
      const r = await fetch("/api/dispatch/drivers-live", { cache: "no-store" });
      const j = await r.json().catch(() => ({} as any));
      if (j?.ok && j?.drivers && typeof j.drivers === "object") {
        setDriverLiveMap(j.drivers);
      }
    } catch {
      // silent: driver health is optional telemetry
    }
  }
  /* JRIDE_UI_DRIVER_HEALTH_LOADER_END */
'@

# Insert loader block right AFTER loadObs() function
$insertAt = $m.Index + $m.Length
$txt = $txt.Insert($insertAt, $loaderBlock)

# Wire into the existing refresh useEffect (the one with load() + loadObs() + setInterval)
# We’ll add loadDriversLive().catch(() => {}); next to loadObs() calls.
if ($txt -notmatch 'useEffect\(\(\)\s*=>\s*\{\s*[\s\S]*loadObs\(\)\.catch\(\(\)\s*=>\s*\{\}\)\s*;') {
  Fail "Could not find expected refresh useEffect pattern (loadObs().catch(() => {});)."
}

# 1) After initial loadObs().catch(() => {});
$txt = [regex]::Replace(
  $txt,
  '(loadObs\(\)\.catch\(\(\)\s*=>\s*\{\}\)\s*;)',
  '$1' + "`n" + '    loadDriversLive().catch(() => {});',
  1
)

# 2) Inside setInterval callback: after loadObs().catch(() => {});
# Do a second replace for the next occurrence
$txt = [regex]::Replace(
  $txt,
  '(loadObs\(\)\.catch\(\(\)\s*=>\s*\{\}\)\s*;)',
  '$1' + "`n" + '      loadDriversLive().catch(() => {});',
  1
)

Set-Content -Path $uiPath -Value $txt -Encoding UTF8
Ok "Patched UI: wired loadDriversLive() into refresh loop"
Ok "Wrote: app\dispatch\page.tsx"

Write-Host ""
Write-Host "[NEXT]" -ForegroundColor Cyan
Write-Host "1) npm.cmd run build" -ForegroundColor Cyan
Write-Host "2) npm.cmd run dev  (open /dispatch and verify driver badges start populating)" -ForegroundColor Cyan
Write-Host "3) git add app/dispatch/page.tsx app/api/dispatch/drivers-live/route.ts" -ForegroundColor Cyan
Write-Host "4) git commit -m `"dispatch: driver health live loader (phase1)`"" -ForegroundColor Cyan
Write-Host "5) git tag dispatch-driver-health-phase1-2025-12-26" -ForegroundColor Cyan
Write-Host "6) git push && git push --tags" -ForegroundColor Cyan
