#requires -Version 5.1
<#
PATCH JRIDE WEB: exact driver_notifications insert + assign_ok response
PS5-safe, ASCII-only

Target:
- app\api\dispatch\assign\route.ts

Based on the CURRENT confirmed file shape:
- updates bookings
- writes booking_assignment_log
- calls sync_drivers_from_bookings
- returns NextResponse.json({ ok: true, ... })

Based on the CURRENT confirmed driver_notifications schema:
- id uuid
- driver_id uuid
- type text
- message text
- is_read boolean
- created_at timestamptz
#>

param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($msg) { throw $msg }

function NowStamp() {
  return (Get-Date).ToString("yyyyMMdd_HHmmss")
}

function EnsureDir($p) {
  if (-not (Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p | Out-Null
  }
}

function ReadText($path) {
  if (-not (Test-Path -LiteralPath $path)) {
    Fail "Missing file: $path"
  }
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function WriteTextUtf8NoBom($path, $content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function BackupFile($src, $bakDir, $tag) {
  EnsureDir $bakDir
  $name = [System.IO.Path]::GetFileName($src)
  $dst = Join-Path $bakDir ($name + ".bak." + $tag + "." + (NowStamp))
  Copy-Item -LiteralPath $src -Destination $dst -Force
  return $dst
}

function EnsureContains($content, $needle, $label) {
  if ($content.IndexOf($needle) -lt 0) {
    Fail "PATCH FAIL ($label): expected anchor missing: $needle"
  }
}

function ReplaceLiteralOnce($content, $find, $replace, $label) {
  $idx = $content.IndexOf($find)
  if ($idx -lt 0) {
    Fail "PATCH FAIL ($label): literal not found."
  }
  $idx2 = $content.IndexOf($find, $idx + $find.Length)
  if ($idx2 -ge 0) {
    Fail "PATCH FAIL ($label): literal appears multiple times. Refuse to patch."
  }
  return $content.Replace($find, $replace)
}

function InsertBeforeLiteralOnce($content, $needle, $insertText, $label) {
  $idx = $content.IndexOf($needle)
  if ($idx -lt 0) {
    Fail "PATCH FAIL ($label): anchor not found."
  }
  $idx2 = $content.IndexOf($needle, $idx + $needle.Length)
  if ($idx2 -ge 0) {
    Fail "PATCH FAIL ($label): anchor appears multiple times. Refuse to patch."
  }
  return $content.Substring(0, $idx) + $insertText + $content.Substring($idx)
}

Write-Host "== PATCH JRIDE WEB: exact driver_notifications insert + assign_ok response (V1 / PS5-safe) ==" -ForegroundColor Cyan
$root = (Resolve-Path -LiteralPath $ProjRoot).Path
Write-Host "Root: $root"

$bakDir = Join-Path $root "_patch_bak"
EnsureDir $bakDir

$assignPath = Join-Path $root "app\api\dispatch\assign\route.ts"
Write-Host "`n== PATCH: $assignPath ==" -ForegroundColor Yellow

$content = ReadText $assignPath
$bak = BackupFile $assignPath $bakDir "DISPATCH_ASSIGN_EXACT_NOTIFY_ASSIGNOK_V1"
Write-Host "[OK] Backup: $bak"

EnsureContains $content 'const nowIso = new Date().toISOString();' "NOWISO_ANCHOR"
EnsureContains $content 'const { data: updRows, error: updErr } = await supabase' "UPDATE_ANCHOR"
EnsureContains $content 'return NextResponse.json(' "RETURN_ANCHOR"

# ---------------------------------------------------
# 1) Insert helper before POST if missing
# ---------------------------------------------------
if ($content.IndexOf('async function insertDriverNotificationExact(') -lt 0) {
  $helper = @'
async function insertDriverNotificationExact(
  supabase: any,
  driverId: string,
  bookingCode: string
): Promise<{ ok: boolean; error?: string | null }> {
  try {
    const message = bookingCode
      ? ("New booking assigned: " + bookingCode)
      : "New booking assigned";

    const ins: any = await supabase
      .from("driver_notifications")
      .insert({
        driver_id: driverId,
        type: "booking_assigned",
        message,
        is_read: false,
        created_at: new Date().toISOString(),
      })
      .select("id")
      .limit(1);

    if (ins?.error) {
      return { ok: false, error: String(ins.error.message || "INSERT_FAILED") };
    }

    return { ok: true, error: null };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e || "INSERT_FAILED") };
  }
}

'@
  $content = InsertBeforeLiteralOnce $content 'export async function POST(req: Request) {' $helper "INSERT_HELPER"
  Write-Host "[OK] Inserted insertDriverNotificationExact() helper"
} else {
  Write-Host "[OK] Helper already present"
}

# ---------------------------------------------------
# 2) Insert notify call before success response if missing
# ---------------------------------------------------
if ($content.IndexOf('const notifyRes = await insertDriverNotificationExact(') -lt 0) {
  $needle = @'
    // Best-effort: sync driver availability/status from bookings
    try {
      const { error: syncErr } = await supabase.rpc("sync_drivers_from_bookings");
      if (syncErr) console.warn("SYNC_DRIVERS_FROM_BOOKINGS_FAILED", syncErr);
    } catch (e) {
      console.warn("SYNC_DRIVERS_FROM_BOOKINGS_THROWN", e);
    }

    return NextResponse.json(
'@

  $replacement = @'
    // Best-effort: sync driver availability/status from bookings
    try {
      const { error: syncErr } = await supabase.rpc("sync_drivers_from_bookings");
      if (syncErr) console.warn("SYNC_DRIVERS_FROM_BOOKINGS_FAILED", syncErr);
    } catch (e) {
      console.warn("SYNC_DRIVERS_FROM_BOOKINGS_THROWN", e);
    }

    const notifyRes = await insertDriverNotificationExact(
      supabase,
      driverId,
      resolvedBookingCode
    );

    return NextResponse.json(
'@
  $content = ReplaceLiteralOnce $content $needle $replacement "INSERT_NOTIFY_CALL"
  Write-Host "[OK] Inserted notification call"
} else {
  Write-Host "[OK] Notification call already present"
}

# ---------------------------------------------------
# 3) Extend success JSON if assign_ok not present
# ---------------------------------------------------
if ($content.IndexOf('assign_ok: true,') -lt 0) {
  $oldReturn = @'
    return NextResponse.json(
      {
        ok: true,
        bookingId: resolvedBookingId,
        bookingCode: resolvedBookingCode,
        fromDriverId: fromDriverId || null,
        toDriverId: driverId,
        status: String(upd.status ?? "assigned"),
        assignedAt: nowIso,
      },
      { status: 200 }
    );
'@

  $newReturn = @'
    return NextResponse.json(
      {
        ok: true,
        assign_ok: true,
        notify_ok: !!notifyRes.ok,
        notify_error: notifyRes.error ?? null,
        bookingId: resolvedBookingId,
        bookingCode: resolvedBookingCode,
        fromDriverId: fromDriverId || null,
        toDriverId: driverId,
        status: String(upd.status ?? "assigned"),
        assignedAt: nowIso,
      },
      { status: 200 }
    );
'@
  $content = ReplaceLiteralOnce $content $oldReturn $newReturn "EXTEND_SUCCESS_JSON"
  Write-Host "[OK] Extended success JSON with assign_ok / notify_ok / notify_error"
} else {
  Write-Host "[OK] Success JSON already contains assign_ok"
}

WriteTextUtf8NoBom $assignPath $content
Write-Host "[OK] Patched: $assignPath"

Write-Host "`n== PATCH COMPLETE ==" -ForegroundColor Green
Write-Host "Next:"
Write-Host "  1) npm run build"
Write-Host "  2) git add -A"
Write-Host "  3) git commit -m ""JRIDE: exact driver_notifications insert + assign_ok on dispatch assign"""
Write-Host "  4) git push"
Write-Host "  5) create one fresh booking"
Write-Host "  6) query public.driver_notifications again"