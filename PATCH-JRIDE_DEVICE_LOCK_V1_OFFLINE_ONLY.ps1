# PATCH-JRIDE_DEVICE_LOCK_V1_OFFLINE_ONLY.ps1
# - Enforce OFFLINE-only takeover for device lock
# - Adds admin reset endpoint: POST /api/admin/driver-device-lock/reset
# - Removes UTF-8 BOM if present
# - Makes conflict responses deterministic (409)

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }

function Get-RootDir {
  $here = (Get-Location).Path
  return $here
}

function Stamp {
  return (Get-Date).ToString("yyyyMMdd_HHmmss")
}

function ReadTextUtf8NoBom($path) {
  if (!(Test-Path $path)) { Fail "Missing file: $path" }
  $txt = Get-Content -LiteralPath $path -Raw -Encoding UTF8

  # Remove BOM if present (U+FEFF)
  if ($txt.Length -gt 0 -and [int][char]$txt[0] -eq 65279) {
    $txt = $txt.Substring(1)
  }
  return $txt
}

function WriteTextUtf8NoBom($path, $txt) {
  $enc = New-Object System.Text.UTF8Encoding($false) # no BOM
  [System.IO.File]::WriteAllText($path, $txt, $enc)
}

function BackupFile($path) {
  $bak = "$path.bak.$(Stamp)"
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function NormalizeNewlines($s) {
  return ($s -replace "`r`n", "`n")
}

function DenormalizeNewlines($s) {
  return ($s -replace "`n", "`r`n")
}

$root = Get-RootDir

# Targets
$liveLocation = Join-Path $root "app\api\live-location\route.ts"
$heartbeat    = Join-Path $root "app\api\driver-heartbeat\route.ts"  # optional patch if pattern matches
$adminReset   = Join-Path $root "app\api\admin\driver-device-lock\reset\route.ts"

# -------- Patch function for routes that contain enforceDeviceLock + conflict handling --------
function Patch-DeviceLockRoute($path) {
  if (!(Test-Path $path)) {
    Write-Host "[WARN] Not found (skipping): $path"
    return
  }

  $orig = ReadTextUtf8NoBom $path
  $txtN = NormalizeNewlines $orig

  # Anchor: the exact conflict block in enforceDeviceLock
  $needleA = @'
  const same = active === deviceId;

  if (!same && !forceTakeover && ageSec < staleSeconds) {
    return { ok: false, conflict: true, active_device_id: active, last_seen_age_seconds: ageSec };
  }

  // Update lock to this device (refresh last_seen and optionally takeover)
'@

  if ($txtN -notlike "*$needleA*") {
    Write-Host "[WARN] Pattern not found; not patching this file: $path"
    return
  }

  # Replace with OFFLINE-only takeover enforcement
  $replaceA = @'
  const same = active === deviceId;

  // If takeover is requested, only allow it when the driver is OFFLINE (server truth)
  if (!same && forceTakeover) {
    const { data: loc, error: locErr } = await supabaseServer
      .from("driver_locations")
      .select("status")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (locErr) throw new Error("driver_locations lookup failed: " + locErr.message);

    const st = norm((loc as any)?.status ?? "");
    // If status is missing/unknown, treat as NOT safe to takeover
    if (!st || st !== "offline") {
      return { ok: false, online_block: true, active_device_id: active, current_status: st || "unknown", last_seen_age_seconds: ageSec };
    }
  }

  if (!same && !forceTakeover && ageSec < staleSeconds) {
    return { ok: false, conflict: true, active_device_id: active, last_seen_age_seconds: ageSec };
  }

  // Update lock to this device (refresh last_seen and optionally takeover)
'@

  $txtN = $txtN.Replace($needleA, $replaceA)

  # Anchor: after "const lock = await enforceDeviceLock(...);"
  $needleB = @'
    const lock = await enforceDeviceLock({
      driverId,
      deviceId,
      nowIso,
      staleSeconds: 120,
      forceTakeover,
    });

    if ((lock as any).conflict) {
'@

  if ($txtN -like "*$needleB*") {
    $replaceB = @'
    const lock = await enforceDeviceLock({
      driverId,
      deviceId,
      nowIso,
      staleSeconds: 120,
      forceTakeover,
    });

    if ((lock as any).online_block) {
      return NextResponse.json(
        {
          ok: false,
          error: "DEVICE_TAKEOVER_REQUIRES_OFFLINE",
          active_device_id: (lock as any).active_device_id,
          current_status: (lock as any).current_status,
          last_seen_age_seconds: (lock as any).last_seen_age_seconds,
        },
        { status: 409 }
      );
    }

    if ((lock as any).conflict) {
'@
    $txtN = $txtN.Replace($needleB, $replaceB)
  } else {
    Write-Host "[WARN] Could not inject online_block response (lock call pattern mismatch): $path"
  }

  BackupFile $path
  $out = DenormalizeNewlines $txtN
  WriteTextUtf8NoBom $path $out
  Write-Host "[OK] Patched: $path"
}

# Patch live-location (required)
Patch-DeviceLockRoute $liveLocation

# Patch heartbeat if it matches the same patterns (safe best-effort)
Patch-DeviceLockRoute $heartbeat

# -------- Add Admin reset endpoint --------
$adminDir = Split-Path -Parent $adminReset
if (!(Test-Path $adminDir)) { New-Item -ItemType Directory -Path $adminDir -Force | Out-Null }

if (!(Test-Path $adminReset)) {
  $adminCode = @'
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const driverId = String(body?.driver_id ?? body?.driverId ?? "").trim();
    if (!driverId) {
      return NextResponse.json({ ok: false, error: "driver_id required" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("driver_device_locks")
      .delete()
      .eq("driver_id", driverId);

    if (error) {
      console.error("admin reset device lock error", error);
      return NextResponse.json({ ok: false, error: "DB_ERROR_RESET" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, driver_id: driverId }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
'@

  WriteTextUtf8NoBom $adminReset $adminCode
  Write-Host "[OK] Created admin reset endpoint: $adminReset"
} else {
  Write-Host "[INFO] Admin reset endpoint already exists, leaving as-is: $adminReset"
}

Write-Host "`n[DONE] Device-lock V1 OFFLINE-only patch applied."
Write-Host "Admin reset endpoint: POST /api/admin/driver-device-lock/reset  { driver_id }"
