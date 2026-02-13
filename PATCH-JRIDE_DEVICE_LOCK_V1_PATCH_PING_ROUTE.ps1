# PATCH-JRIDE_DEVICE_LOCK_V1_PATCH_PING_ROUTE.ps1
# Patches: app/api/driver/location/ping/route.ts
# Adds device lock enforcement + OFFLINE-only takeover to the ping writer route.
# Writes UTF-8 no BOM and makes a backup.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp { (Get-Date).ToString("yyyyMMdd_HHmmss") }

function ReadUtf8NoBom($path) {
  if (!(Test-Path $path)) { Fail "Missing file: $path" }
  $txt = Get-Content -LiteralPath $path -Raw -Encoding UTF8
  if ($txt.Length -gt 0 -and [int][char]$txt[0] -eq 65279) { $txt = $txt.Substring(1) } # strip BOM
  return $txt
}

function WriteUtf8NoBom($path, $txt) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $txt, $enc)
}

function Backup($path) {
  $bak = "$path.bak.$(Stamp)"
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

$root = (Get-Location).Path
$target = Join-Path $root "app\api\driver\location\ping\route.ts"
$orig = ReadUtf8NoBom $target
$txt = $orig

if ($txt -match "JRIDE_DEVICE_LOCK_PING_V1") {
  Write-Host "[INFO] Patch marker already present; skipping: $target"
  exit 0
}

# ---- 1) Inject helper functions (device id + device lock) after str() ----
$needle1 = @'
function str(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}
'@

if ($txt -notlike "*$needle1*") {
  Fail "Could not find anchor for str() function. Paste current ping route.ts if it changed."
}

$inject1 = @'
function str(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/* JRIDE_DEVICE_LOCK_PING_V1
   - Enforce single active device per driver_id for this writer route
   - OFFLINE-only takeover (force_takeover=true only if driver_locations.status == 'offline')
*/
function norm(s: any): string {
  return String(s ?? "").trim().toLowerCase();
}

function pickDeviceId(req: Request, body: any): string {
  const fromBody = String(body?.device_id ?? body?.deviceId ?? "").trim();
  if (fromBody) return fromBody;

  // Backward-compatible fallback
  const ua = String(req.headers.get("user-agent") ?? "").slice(0, 160);
  const xff = String(req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const seed = (ua + "|" + xff).trim();
  return seed ? ("fallback:" + seed) : "fallback:unknown";
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

  const { data: lock, error: lockErr } = await supabase
    .from("driver_device_locks")
    .select("driver_id, device_id, last_seen")
    .eq("driver_id", driverId)
    .maybeSingle();

  if (lockErr) throw new Error("driver_device_locks lookup failed: " + lockErr.message);

  if (!lock) {
    const { error: insErr } = await supabase
      .from("driver_device_locks")
      .insert({ driver_id: driverId, device_id: deviceId, last_seen: nowIso });

    if (insErr) throw new Error("driver_device_locks insert failed: " + insErr.message);
    return { ok: true, claimed: true, active_device_id: deviceId };
  }

  const active = String(lock.device_id ?? "");
  const lastSeen = lock.last_seen ? new Date(lock.last_seen as any).getTime() : 0;
  const nowMs = new Date(nowIso).getTime();
  const ageSec = lastSeen ? Math.floor((nowMs - lastSeen) / 1000) : 999999;

  const same = active === deviceId;

  // OFFLINE-only takeover enforcement (server truth)
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

  if (!same && !forceTakeover && ageSec < staleSeconds) {
    return { ok: false, conflict: true, active_device_id: active, last_seen_age_seconds: ageSec };
  }

  const { error: upErr } = await supabase
    .from("driver_device_locks")
    .update({ device_id: deviceId, last_seen: nowIso })
    .eq("driver_id", driverId);

  if (upErr) throw new Error("driver_device_locks update failed: " + upErr.message);

  return { ok: true, claimed: !same, active_device_id: deviceId, last_seen_age_seconds: ageSec };
}
'@

$txt = $txt.Replace($needle1, $inject1)

# ---- 2) Inject lock enforcement into POST, right after driver_id validation ----
$needle2 = @'
    if (!driver_id) {
      return json(400, { ok: false, code: "BAD_REQUEST", message: "driver_id is required" });
    }
'@

if ($txt -notlike "*$needle2*") {
  Fail "Could not find anchor for driver_id required block."
}

$inject2 = @'
    if (!driver_id) {
      return json(400, { ok: false, code: "BAD_REQUEST", message: "driver_id is required" });
    }

    // Device lock enforcement for this writer route
    const nowIso = new Date().toISOString();
    const deviceId = pickDeviceId(req, body);
    const forceTakeover = !!(body?.force_takeover ?? body?.forceTakeover ?? false);

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
'@

# BUT: in your file, `supabase` is created later. We need to move the `const supabase = createClient(...)`
# ABOVE this injection. So we will instead anchor after supabase creation and inject there.

# Undo the previous plan and use the correct anchor:
$txt = $txt # no-op

$needle3 = @'
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
'@

if ($txt -notlike "*$needle3*") {
  Fail "Could not find anchor for supabase createClient()"
}

$inject3 = @'
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Device lock enforcement for this writer route
    const nowIso = new Date().toISOString();
    const deviceId = pickDeviceId(req, body);
    const forceTakeover = !!(body?.force_takeover ?? body?.forceTakeover ?? false);

    const lock = await enforceDeviceLockPing({
      supabase,
      driverId: driver_id!,
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
'@

$txt = $txt.Replace($needle3, $inject3)

Backup $target
WriteUtf8NoBom $target $txt
Write-Host "[OK] Patched: $target"
Write-Host "`n[DONE] Ping route now enforces device lock + OFFLINE-only takeover."
