# PATCH-JRIDE_DRIVER_LOCATION_PING_EDGE_TRIGGER_RETRY_V1_PS5SAFE.ps1
# PS5-safe
# Replaces: app/api/driver/location/ping/route.ts
# Goal:
# - Preserve current ping/device-lock behavior
# - Add edge-triggered retry-auto-assign when driver transitions to online
# - Do NOT trigger retry on every ping
# - Do NOT fail ping if retry endpoint fails

param(
  [Parameter(Mandatory = $true)]
  [string]$WebRoot
)

$ErrorActionPreference = "Stop"

function Write-Info($msg) {
  Write-Host $msg -ForegroundColor Cyan
}

function Write-Ok($msg) {
  Write-Host $msg -ForegroundColor Green
}

function Write-WarnMsg($msg) {
  Write-Host $msg -ForegroundColor Yellow
}

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

$target = Join-Path $WebRoot "app\api\driver\location\ping\route.ts"
if (-not (Test-Path -LiteralPath $target)) {
  throw "Target file not found: $target"
}

$bakDir = Join-Path (Split-Path -Parent $target) "_patch_bak"
Ensure-Dir $bakDir

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("route.ts.bak.DRIVER_LOCATION_PING_EDGE_TRIGGER_RETRY_V1.{0}" -f $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Ok "[OK] Backup: $bak"

$content = @'
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

function norm(s: any): string {
  return String(s ?? "").trim().toLowerCase();
}

function normDeviceId(s: any): string {
  return String(s ?? "").trim().toLowerCase();
}

function pickDeviceId(req: Request, body: any): string {
  const fromBody = String(body?.device_id ?? body?.deviceId ?? "");
  if (fromBody && fromBody.trim()) return normDeviceId(fromBody);

  const ua = String(req.headers.get("user-agent") ?? "").slice(0, 160);
  const xff = String(req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const seed = (ua + "|" + xff).trim();
  return normDeviceId(seed ? "fallback:" + seed : "fallback:unknown");
}

async function enforceDeviceLockPing(opts: {
  supabase: any;
  driverId: string;
  deviceId: string;
  nowIso: string;
  staleSeconds: number;
  forceTakeover: boolean;
}) {
  const { supabase, driverId, deviceId, nowIso, staleSeconds, forceTakeover } = opts;

  const reqDevice = normDeviceId(deviceId);

  const { data: lock, error: lockErr } = await supabase
    .from("driver_device_locks")
    .select("driver_id, device_id, last_seen")
    .eq("driver_id", driverId)
    .maybeSingle();

  if (lockErr) throw new Error("driver_device_locks lookup failed: " + lockErr.message);

  if (!lock) {
    const { error: insErr } = await supabase
      .from("driver_device_locks")
      .insert({ driver_id: driverId, device_id: reqDevice, last_seen: nowIso });

    if (insErr) throw new Error("driver_device_locks insert failed: " + insErr.message);

    return { ok: true, claimed: true, active_device_id: reqDevice, last_seen_age_seconds: 0 };
  }

  const active = normDeviceId(lock.device_id ?? "");
  const lastSeen = lock.last_seen ? new Date(lock.last_seen as any).getTime() : 0;
  const nowMs = new Date(nowIso).getTime();
  const ageSec = lastSeen ? Math.floor((nowMs - lastSeen) / 1000) : 999999;

  const same = active === reqDevice;

  if (same) {
    const { error: hbErr } = await supabase
      .from("driver_device_locks")
      .update({ last_seen: nowIso })
      .eq("driver_id", driverId);

    if (hbErr) throw new Error("driver_device_locks heartbeat update failed: " + hbErr.message);

    return { ok: true, claimed: false, active_device_id: active, last_seen_age_seconds: ageSec };
  }

  if (!same && forceTakeover) {
    const { data: loc, error: locErr } = await supabase
      .from("driver_locations")
      .select("status")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (locErr) throw new Error("driver_locations lookup failed: " + locErr.message);

    const st = norm((loc as any)?.status ?? "");
    if (!st || st !== "offline") {
      return {
        ok: false,
        online_block: true,
        active_device_id: active,
        current_status: st || "unknown",
        last_seen_age_seconds: ageSec,
      };
    }
  }

  if (!forceTakeover && ageSec < staleSeconds) {
    return { ok: false, conflict: true, active_device_id: active, last_seen_age_seconds: ageSec };
  }

  const { error: upErr } = await supabase
    .from("driver_device_locks")
    .update({ device_id: reqDevice, last_seen: nowIso })
    .eq("driver_id", driverId);

  if (upErr) throw new Error("driver_device_locks update failed: " + upErr.message);

  return { ok: true, claimed: true, active_device_id: reqDevice, last_seen_age_seconds: ageSec };
}

async function triggerRetryAutoAssign(baseUrl: string) {
  if (!baseUrl || !String(baseUrl).trim()) {
    return {
      attempted: false,
      ok: false,
      skipped: true,
      reason: "BASE_URL_MISSING",
    };
  }

  const url = String(baseUrl).replace(/\/+$/, "") + "/api/dispatch/retry-auto-assign";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    let body: any = null;
    try {
      body = await res.json();
    } catch (_) {
      body = null;
    }

    return {
      attempted: true,
      ok: res.ok,
      status: res.status,
      body,
      url,
    };
  } catch (e: any) {
    return {
      attempted: true,
      ok: false,
      status: 0,
      error: String(e?.message ?? e),
      url,
    };
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const driver_id = String(body?.driver_id ?? body?.driverId ?? "").trim();
    if (!driver_id) return json(400, { ok: false, code: "MISSING_DRIVER_ID" });

    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

    const status = norm(body?.status ?? "online") || "online";
    const town = String(body?.town ?? "").trim();
    const forceTakeover = !!(body?.force_takeover ?? body?.forceTakeover ?? false);

    const SUPABASE_URL = envAny(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
    const SUPABASE_SERVICE_ROLE = envAny(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE"]);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return json(500, { ok: false, code: "SUPABASE_ENV_MISSING" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const nowIso = new Date().toISOString();
    const deviceId = pickDeviceId(req, body);

    const lock = await enforceDeviceLockPing({
      supabase,
      driverId: driver_id,
      deviceId,
      nowIso,
      staleSeconds: 120,
      forceTakeover,
    });

    if ((lock as any).online_block) {
      return json(409, {
        ok: false,
        code: "DEVICE_TAKEOVER_REQUIRES_OFFLINE",
        active_device_id: (lock as any).active_device_id,
        current_status: (lock as any).current_status,
        last_seen_age_seconds: (lock as any).last_seen_age_seconds,
      });
    }

    if ((lock as any).conflict) {
      return json(409, {
        ok: false,
        code: "DEVICE_LOCKED",
        active_device_id: (lock as any).active_device_id,
        last_seen_age_seconds: (lock as any).last_seen_age_seconds,
      });
    }

    const { data: prevLoc, error: prevLocErr } = await supabase
      .from("driver_locations")
      .select("status")
      .eq("driver_id", driver_id)
      .maybeSingle();

    if (prevLocErr) {
      return json(500, {
        ok: false,
        code: "PREV_DRIVER_LOCATION_LOOKUP_FAILED",
        message: prevLocErr.message,
      });
    }

    const previousStatus = norm((prevLoc as any)?.status ?? "");

    const upsertPayload: any = {
      driver_id,
      status,
      town: town || null,
      updated_at: nowIso,
    };

    if (hasCoords) {
      upsertPayload.lat = lat;
      upsertPayload.lng = lng;
    }

    const { error: upErr } = await supabase
      .from("driver_locations")
      .upsert(upsertPayload, { onConflict: "driver_id", ignoreDuplicates: false });

    if (upErr) {
      return json(500, {
        ok: false,
        code: "INSERT_FAILED",
        message: upErr.message,
        detail: { upsert_error: upErr.message },
      });
    }

    const becameOnline = previousStatus !== "online" && status === "online";

    let retryResult: any = {
      attempted: false,
      ok: false,
      skipped: true,
      reason: "NOT_ONLINE_EDGE",
    };

    if (becameOnline) {
      const BASE_URL = envAny([
        "INTERNAL_BASE_URL",
        "NEXT_PUBLIC_BASE_URL",
        "NEXTAUTH_URL",
      ]);

      retryResult = await triggerRetryAutoAssign(BASE_URL);
    }

    return json(200, {
      ok: true,
      driver_id,
      status,
      previous_status: previousStatus || null,
      became_online: becameOnline,
      retry_triggered: !!(retryResult?.attempted),
      retry_ok: !!(retryResult?.ok),
      retry_result: retryResult,
      town: town || null,
      claimed: !!(lock as any).claimed,
      active_device_id: (lock as any).active_device_id,
    });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: e?.message ?? String(e) });
  }
}
'@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $content, $utf8NoBom)
Write-Ok "[OK] Patched: $target"

Write-Host ""
Write-Ok "PATCH COMPLETE"
Write-Info "What changed:"
Write-Host " - Preserved current device lock logic"
Write-Host " - Preserved driver_locations upsert"
Write-Host " - Added previous status lookup"
Write-Host " - Added edge-triggered retry when previous_status != online and new status == online"
Write-Host " - Retry failure is non-fatal to ping"
Write-Host " - Base URL lookup order: INTERNAL_BASE_URL, NEXT_PUBLIC_BASE_URL, NEXTAUTH_URL"