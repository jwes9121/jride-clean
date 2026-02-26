param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function NowStamp { Get-Date -Format "yyyyMMdd_HHmmss" }

function RxReplaceFirst([string]$text, [string]$pattern, [string]$replacement, [System.Text.RegularExpressions.RegexOptions]$opts) {
  $rx = New-Object System.Text.RegularExpressions.Regex($pattern, $opts)
  return $rx.Replace($text, $replacement, 1)
}

function Assert-Contains([string]$text, [string]$needle, [string]$msg) {
  if ($text.IndexOf($needle, [System.StringComparison]::Ordinal) -lt 0) { throw $msg }
}

$root = (Resolve-Path -LiteralPath $ProjRoot).Path
$target = Join-Path $root "app\api\dispatch\status\route.ts"
if (!(Test-Path -LiteralPath $target)) { throw "Target not found: $target" }

$bakDir = Join-Path $root "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir ("route.ts.bak.DISPATCH_STATUS_DEVICELOCK_AUTH_V1_3." + (NowStamp))
Copy-Item -LiteralPath $target -Destination $bak -Force

$src = Get-Content -LiteralPath $target -Raw

# ---- 1) Ensure supabase-js import exists ----
if ($src -notmatch 'createSupabaseAdmin') {
  $pat = 'import\s+\{\s*NextResponse\s*\}\s+from\s+["'']next/server["''];'
  if ($src -notmatch $pat) { throw "Could not find NextResponse import." }

  $before = $src
  $src = RxReplaceFirst $src $pat ('$0' + "`r`n" + 'import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";') ([System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if ($src -eq $before) { throw "Failed to insert supabase-js import." }
}

# ---- 2) Insert supabaseAdmin + helpers after createClient import ----
if ($src -notmatch 'const\s+supabaseAdmin\s*=\s*createSupabaseAdmin') {
  $pat = 'import\s+\{\s*createClient\s*\}\s+from\s+["'']@/utils/supabase/server["''];\s*\r?\n'
  if ($src -notmatch $pat) { throw "Could not find createClient import from @/utils/supabase/server." }

  $adminBlock = @'
const supabaseAdmin = createSupabaseAdmin(
  (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "") as string,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || "") as string,
  { auth: { persistSession: false } }
);

function hasServiceRoleEnv(): { ok: boolean; reason?: string } {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url) return { ok: false, reason: "MISSING_SUPABASE_URL" };
  if (!key) return { ok: false, reason: "MISSING_SERVICE_ROLE_KEY" };
  return { ok: true };
}

async function ensureDriverDeviceLock(driverId: string, deviceId: string): Promise<
  | { ok: true }
  | { ok: false; code: string; message: string; status: number; extra?: any }
> {
  const eok = hasServiceRoleEnv();
  if (!eok.ok) return { ok: false, code: "SERVER_MISCONFIG", message: eok.reason || "ENV_ERROR", status: 500 };

  const { data: locks, error: lockErr } = await supabaseAdmin
    .from("driver_device_locks")
    .select("driver_id, device_id, created_at")
    .eq("driver_id", driverId)
    .limit(1);

  if (lockErr) return { ok: false, code: "DB_ERROR_DEVICE_LOCK", message: "Device lock lookup failed", status: 500 };

  const row: any = (Array.isArray(locks) && locks.length) ? locks[0] : null;

  if (!row) {
    const { error: insErr } = await supabaseAdmin
      .from("driver_device_locks")
      .insert([{ driver_id: driverId, device_id: deviceId }]);

    if (insErr) return { ok: false, code: "DB_ERROR_DEVICE_LOCK_CREATE", message: "Failed to create device lock", status: 500 };
    return { ok: true };
  }

  const lockedDevice = String(row?.device_id ?? "").trim();
  if (lockedDevice && lockedDevice !== deviceId) {
    return { ok: false, code: "DEVICE_LOCKED", message: "Driver is locked to another device", status: 403, extra: { locked_device_id: lockedDevice } };
  }

  return { ok: true };
}

async function enforceDriverOwnsBooking(driverId: string, bookingId: any, bookingCode: any): Promise<
  | { ok: true; booking: any }
  | { ok: false; code: string; message: string; status: number }
> {
  const bid = String(bookingId ?? "").trim();
  const bcode = String(bookingCode ?? "").trim();

  let q: any = supabaseAdmin.from("bookings").select("id, booking_code, driver_id, assigned_driver_id, status").limit(1);

  if (bid) q = q.eq("id", bid);
  else if (bcode) q = q.eq("booking_code", bcode);
  else return { ok: false, code: "MISSING_BOOKING", message: "booking_id or booking_code required", status: 400 };

  const { data, error } = await q;
  if (error) return { ok: false, code: "DB_ERROR_BOOKING_LOOKUP", message: "Booking lookup failed", status: 500 };

  const bk: any = (Array.isArray(data) && data.length) ? data[0] : null;
  if (!bk) return { ok: false, code: "NOT_FOUND", message: "Booking not found", status: 404 };

  const bDriver = String(bk?.driver_id ?? "").trim();
  const bAssigned = String(bk?.assigned_driver_id ?? "").trim();
  if (bDriver !== driverId && bAssigned !== driverId) {
    return { ok: false, code: "FORBIDDEN", message: "Booking not owned by this driver", status: 403 };
  }

  return { ok: true, booking: bk };
}
'@

  $before = $src
  $src = RxReplaceFirst $src $pat ('$0' + $adminBlock + "`r`n") ([System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if ($src -eq $before) { throw "Failed to insert supabaseAdmin helper block." }
}

# ---- 3) Ensure rawBody parsed once after createClient() ----
Assert-Contains $src "export async function POST" "POST handler not found."
Assert-Contains $src "const supabase = createClient();" "Anchor 'const supabase = createClient();' not found."

if ($src -notmatch 'const\s+rawBody\s*=\s*\(await\s+req\.json') {
  $pat = 'const\s+supabase\s*=\s*createClient\(\);\s*\r?\n'
  $rep = 'const supabase = createClient();' + "`r`n" + '  const rawBody = (await req.json().catch(() => ({}))) as any;' + "`r`n"
  $before = $src
  $src = RxReplaceFirst $src $pat $rep ([System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if ($src -eq $before) { throw "Failed to insert rawBody parse after createClient()." }
}

# ---- 4) Replace UNAUTHORIZED block ----
$unauthPat = 'if\s*\(\s*!actorUserId\s*\)\s*\{\s*return\s+jsonErr\(\s*"UNAUTHORIZED"\s*,\s*"Not authenticated"\s*,\s*401\s*\)\s*;\s*\}'
$replacement = @'
if (!actorUserId) {
      // Driver mobile secure auth path: driver_id + device_id + device-lock + booking ownership
      const driverId = String(rawBody?.driver_id ?? rawBody?.driverId ?? "").trim();
      const deviceId = String(rawBody?.device_id ?? rawBody?.deviceId ?? "").trim();

      if (driverId && deviceId) {
        const lock = await ensureDriverDeviceLock(driverId, deviceId);
        if (!lock.ok) {
          return jsonErr(lock.code, lock.message, lock.status, (lock as any).extra);
        }

        const booking_id_pre =
          rawBody?.booking_id ??
          rawBody?.bookingId ??
          rawBody?.id ??
          rawBody?.booking?.id ??
          null;

        const booking_code_pre =
          rawBody?.booking_code ??
          rawBody?.bookingCode ??
          rawBody?.code ??
          rawBody?.booking?.booking_code ??
          rawBody?.booking?.bookingCode ??
          null;

        const owns = await enforceDriverOwnsBooking(driverId, booking_id_pre, booking_code_pre);
        if (!(owns as any).ok) {
          return jsonErr((owns as any).code, (owns as any).message, (owns as any).status);
        }

        // Auth OK via device lock
        actorUserId = null;
      } else {
        return jsonErr("UNAUTHORIZED", "Not authenticated", 401);
      }
    }
'@

$rxUnauth = New-Object System.Text.RegularExpressions.Regex($unauthPat, ([System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor [System.Text.RegularExpressions.RegexOptions]::Singleline))
$before = $src
$src = $rxUnauth.Replace($src, $replacement, 1)
if ($src -eq $before) { throw "Patch failed: could not locate the UNAUTHORIZED block (pattern mismatch)." }

Set-Content -LiteralPath $target -Value $src -Encoding UTF8

Write-Host "== JRIDE Patch: dispatch/status secure driver device-lock auth (V1_3 / PS5-safe) ==" -ForegroundColor Cyan
Write-Host "[OK] Backup: $bak" -ForegroundColor Green
Write-Host "[OK] Patched: $target" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT: build" -ForegroundColor Cyan
Write-Host "  npm.cmd run build"