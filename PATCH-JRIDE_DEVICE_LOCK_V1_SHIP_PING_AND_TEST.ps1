# PATCH-JRIDE_DEVICE_LOCK_V1_SHIP_PING_AND_TEST.ps1
# - Adds device-lock enforcement (+ OFFLINE-only takeover) to:
#     app/api/driver/location/ping/route.ts
# - Disables /api/driver_locations_test in production unless secret header present
# - UTF-8 no BOM writes + backups

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

# -------------------------
# A) Patch ping writer route
# -------------------------
$pingPath = Join-Path $root "app\api\driver\location\ping\route.ts"
$ping = ReadUtf8NoBom $pingPath

if ($ping -match "JRIDE_DEVICE_LOCK_PING_V1") {
  Write-Host "[INFO] Ping patch marker already present; skipping: $pingPath"
} else {
  # 1) Inject helpers after str()
  $anchorStr = @'
function str(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}
'@

  if ($ping -notlike "*$anchorStr*") { Fail "Ping: could not find str() anchor. File changed." }

  $injectHelpers = @'
function str(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/* JRIDE_DEVICE_LOCK_PING_V1
   - Enforce single active device per driver_id for this service-role writer route
   - OFFLINE-only takeover (force_takeover=true only if driver_locations.status == 'offline')
*/
function norm(s: any): string {
  return String(s ?? "").trim().toLowerCase();
}

function pickDeviceId(req: Request, body: any): string {
  const fromBody = String(body?.device_id ?? body?.deviceId ?? "").trim();
  if (fromBody) return fromBody;

  // Backward-compatible fallback (UA + x-forwarded-for). Not perfect, but prevents accidental overwrite.
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

  $ping = $ping.Replace($anchorStr, $injectHelpers)

  # 2) Inject enforcement immediately after supabase client is created
  $anchorSupabase = @'
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
'@

  if ($ping -notlike "*$anchorSupabase*") { Fail "Ping: could not find createClient() anchor. File changed." }

  $injectEnforce = @'
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

  $ping = $ping.Replace($anchorSupabase, $injectEnforce)

  Backup $pingPath
  WriteUtf8NoBom $pingPath $ping
  Write-Host "[OK] Patched: $pingPath"
}

# ---------------------------------------
# B) Disable driver_locations_test in prod
# ---------------------------------------
$testPath = Join-Path $root "app\api\driver_locations_test\route.ts"
if (Test-Path $testPath) {
  $test = ReadUtf8NoBom $testPath

  if ($test -match "JRIDE_DRIVER_LOC_TEST_GUARD_V1") {
    Write-Host "[INFO] driver_locations_test guard marker already present; skipping: $testPath"
  } else {
    # Insert guard right after exports/dynamic (or after imports if not found)
    $guardBlock = @'
/* JRIDE_DRIVER_LOC_TEST_GUARD_V1
   This route can SPOOF driver locations (service role). It must never be open in production.
   Allowed only if:
   - NODE_ENV !== "production", OR
   - header x-jride-test-secret matches DRIVER_LOC_TEST_SECRET
*/
function allowTestRoute(req: Request): boolean {
  const isProd = String(process.env.NODE_ENV ?? "").toLowerCase() === "production";
  if (!isProd) return true;

  const secret = String(process.env.DRIVER_LOC_TEST_SECRET ?? "").trim();
  if (!secret) return false;

  const got = String(req.headers.get("x-jride-test-secret") ?? "");
  return got === secret;
}
'@

    # Find a safe insertion point: after `export const dynamic = ...` if present
    $insPoint = 'export const dynamic = "force-dynamic";'
    if ($test -like "*$insPoint*") {
      $test = $test.Replace($insPoint, $insPoint + "`r`n`r`n" + $guardBlock)
    } else {
      # fallback: after last import line
      $m = [regex]::Match($test, "^(import[^\r\n]+\r?\n)+", "Multiline")
      if (!$m.Success) { Fail "driver_locations_test: could not find import block to insert guard." }
      $test = $test.Insert($m.Length, "`r`n" + $guardBlock + "`r`n")
    }

    # Add guard checks at start of POST and GET
    $postAnchor = "export async function POST(req: Request) {"
    if ($test -notlike "*$postAnchor*") { Fail "driver_locations_test: POST anchor not found." }
    $test = $test.Replace($postAnchor, $postAnchor + "`r`n  if (!allowTestRoute(req)) {`r`n    return NextResponse.json({ error: 'DISABLED_IN_PROD' }, { status: 404 });`r`n  }")

    $getAnchor = "export async function GET() {"
    if ($test -notlike "*$getAnchor*") { Fail "driver_locations_test: GET anchor not found." }
    $test = $test.Replace($getAnchor, "export async function GET(req: Request) {`r`n  if (!allowTestRoute(req)) {`r`n    return NextResponse.json({ error: 'DISABLED_IN_PROD' }, { status: 404 });`r`n  }")

    Backup $testPath
    WriteUtf8NoBom $testPath $test
    Write-Host "[OK] Guarded: $testPath"
  }
} else {
  Write-Host "[INFO] driver_locations_test route not found (skipping): $testPath"
}

Write-Host "`n[DONE] JRIDE_DEVICE_LOCK_V1 ship patch complete (ping + driver_locations_test)."
