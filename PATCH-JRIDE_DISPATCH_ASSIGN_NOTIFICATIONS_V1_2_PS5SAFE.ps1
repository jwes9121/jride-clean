#requires -Version 5.1
<#
PATCH JRIDE WEB: dispatch/assign add driver_notifications insert + idempotency (V1.2 / PS5-safe / ASCII-only)

Target:
- app\api\dispatch\assign\route.ts

What it does (idempotent):
1) Ensures helper insertDriverNotificationBestEffort() exists (inserts before POST if missing)
2) Ensures notify state vars exist after "const updated = ..." line
3) Inserts notify call before the success "return jOk({" (after the "!updated" race check) using a regex
4) Extends success JSON with notify_ok / notify_duplicate / notify_error

Refuses to patch if:
- It cannot find key anchors
- It finds ambiguous multi-matches where insertion would be unsafe
#>

param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($msg) { throw $msg }
function NowStamp() { return (Get-Date).ToString("yyyyMMdd_HHmmss") }

function EnsureDir($p) {
  if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

function ReadText($path) {
  if (-not (Test-Path -LiteralPath $path)) { Fail "Missing file: $path" }
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
  if ($content.IndexOf($needle) -lt 0) { Fail "PATCH FAIL ($label): expected anchor missing: $needle" }
}

function ReplaceLiteralOnce($content, $find, $replace, $label) {
  $idx = $content.IndexOf($find)
  if ($idx -lt 0) { Fail "PATCH FAIL ($label): literal not found." }
  $idx2 = $content.IndexOf($find, $idx + $find.Length)
  if ($idx2 -ge 0) { Fail "PATCH FAIL ($label): literal appears multiple times. Refuse to patch." }
  return $content.Replace($find, $replace)
}

function InsertBeforeLiteralOnce($content, $needle, $insertText, $label) {
  $idx = $content.IndexOf($needle)
  if ($idx -lt 0) { Fail "PATCH FAIL ($label): anchor not found." }
  $idx2 = $content.IndexOf($needle, $idx + $needle.Length)
  if ($idx2 -ge 0) { Fail "PATCH FAIL ($label): anchor appears multiple times. Refuse to patch." }
  return $content.Substring(0, $idx) + $insertText + $content.Substring($idx)
}

function ReplaceRegexExactlyOnce($content, $pattern, $replacement, $label) {
  $opts = [System.Text.RegularExpressions.RegexOptions]::Singleline
  $re = New-Object System.Text.RegularExpressions.Regex($pattern, $opts)
  $m = $re.Matches($content)
  if ($m.Count -lt 1) { Fail "PATCH FAIL ($label): pattern not found." }
  if ($m.Count -gt 1) { Fail "PATCH FAIL ($label): pattern matched multiple times ($($m.Count)). Refuse to patch." }
  return $re.Replace($content, $replacement, 1)
}

Write-Host "== PATCH JRIDE WEB: dispatch/assign notifications + idempotency (V1.2 / PS5-safe) ==" -ForegroundColor Cyan
$root = (Resolve-Path -LiteralPath $ProjRoot).Path
Write-Host "Root: $root"

$bakDir = Join-Path $root "_patch_bak"
EnsureDir $bakDir

$assignPath = Join-Path $root "app\api\dispatch\assign\route.ts"
Write-Host "`n== PATCH: $assignPath ==" -ForegroundColor Yellow

$content = ReadText $assignPath
$bak = BackupFile $assignPath $bakDir "DISPATCH_ASSIGN_NOTIFICATIONS_V1_2"
Write-Host "[OK] Backup: $bak"

# --- anchors we require ---
EnsureContains $content 'export async function POST(req: Request) {' "POST_FN_ANCHOR"
EnsureContains $content 'return jOk({' "SUCCESS_RETURN_ANCHOR"
EnsureContains $content 'const updated = Array.isArray(upd) && upd.length ? upd[0] : null;' "UPDATED_LINE_ANCHOR"

# ---------------------------------------------------
# 1) Ensure helper exists (insert before POST if missing)
# ---------------------------------------------------
if ($content.IndexOf('async function insertDriverNotificationBestEffort(') -ge 0) {
  Write-Host "[OK] Helper already present"
} else {
  $helper = @'
async function insertDriverNotificationBestEffort(
  admin: any,
  driverId: string,
  booking: any
): Promise<{ ok: boolean; duplicate: boolean; error?: string | null }> {
  const nowIso = new Date().toISOString();
  const bookingId = String(booking?.id ?? "").trim();
  const bookingCode = String(booking?.booking_code ?? "").trim();

  // Best-effort duplicate checks (swallow schema mismatch errors)
  try {
    if (bookingId) {
      const q1: any = await admin
        .from("driver_notifications")
        .select("id")
        .eq("driver_id", driverId)
        .eq("booking_id", bookingId)
        .limit(1);
      const rows1 = Array.isArray(q1?.data) ? q1.data : [];
      if (rows1.length > 0) return { ok: true, duplicate: true, error: null };
    }
  } catch {}

  try {
    if (bookingCode) {
      const q2: any = await admin
        .from("driver_notifications")
        .select("id")
        .eq("driver_id", driverId)
        .eq("booking_code", bookingCode)
        .limit(1);
      const rows2 = Array.isArray(q2?.data) ? q2.data : [];
      if (rows2.length > 0) return { ok: true, duplicate: true, error: null };
    }
  } catch {}

  const payloadObj: any = {
    kind: "dispatch_assign",
    booking_id: bookingId || null,
    booking_code: bookingCode || null,
    status: String(booking?.status ?? "assigned"),
    town: (booking as any)?.town ?? null,
  };

  const title = bookingCode
    ? ("New booking assigned: " + bookingCode)
    : "New booking assigned";

  const body = (booking as any)?.town
    ? ("You have a new assigned booking in " + String((booking as any).town))
    : "You have a new assigned booking.";

  // Try richest -> leanest shapes to tolerate schema differences
  const candidates: any[] = [
    {
      driver_id: driverId,
      booking_id: bookingId || null,
      booking_code: bookingCode || null,
      type: "dispatch_assign",
      title,
      body,
      payload: payloadObj,
      is_read: false,
      created_at: nowIso,
    },
    {
      driver_id: driverId,
      booking_id: bookingId || null,
      booking_code: bookingCode || null,
      type: "dispatch_assign",
      title,
      body,
      created_at: nowIso,
    },
    {
      driver_id: driverId,
      booking_id: bookingId || null,
      booking_code: bookingCode || null,
      created_at: nowIso,
    },
    {
      driver_id: driverId,
      booking_id: bookingId || null,
      created_at: nowIso,
    },
    {
      driver_id: driverId,
      booking_code: bookingCode || null,
      created_at: nowIso,
    },
    {
      driver_id: driverId,
      created_at: nowIso,
    },
  ];

  let lastError = "";

  for (const row of candidates) {
    try {
      const ins: any = await admin
        .from("driver_notifications")
        .insert(row)
        .select("id")
        .limit(1);

      if (!ins?.error) return { ok: true, duplicate: false, error: null };
      lastError = String(ins.error?.message || "INSERT_FAILED");
    } catch (e: any) {
      lastError = String(e?.message || e || "INSERT_FAILED");
    }
  }

  return { ok: false, duplicate: false, error: lastError || "INSERT_FAILED" };
}

'@
  $content = InsertBeforeLiteralOnce $content 'export async function POST(req: Request) {' $helper "INSERT_HELPER_BEFORE_POST"
  Write-Host "[OK] Inserted helper"
}

# ---------------------------------------------------
# 2) Ensure notify state vars exist after updated line
# ---------------------------------------------------
if ($content.IndexOf("let notifyOk = false;") -ge 0) {
  Write-Host "[OK] notify state vars already present"
} else {
  $updatedLine = '    const updated = Array.isArray(upd) && upd.length ? upd[0] : null;'
  $notifyVars = @'
    const updated = Array.isArray(upd) && upd.length ? upd[0] : null;
    let notifyOk = false;
    let notifyDuplicate = false;
    let notifyError: string | null = null;
'@
  $content = ReplaceLiteralOnce $content $updatedLine $notifyVars "INSERT_NOTIFY_VARS_AFTER_UPDATED"
  Write-Host "[OK] Inserted notify state vars"
}

# ---------------------------------------------------
# 3) Insert notify call between "!updated" block and success return jOk({
# ---------------------------------------------------
if ($content.IndexOf("const notifyRes = await insertDriverNotificationBestEffort(") -ge 0) {
  Write-Host "[OK] notify call already present"
} else {
  # Pattern: a single "!updated" guard followed by return jOk({
  $pat = '(?s)(\n\s*if\s*\(\s*!\s*updated\s*\)\s*\{.*?\n\s*\}\s*\n)(\s*return\s+jOk\s*\(\s*\{)'
  $rep = @'
$1
    const notifyRes = await insertDriverNotificationBestEffort(admin, chosenDriverId, updated);
    notifyOk = !!notifyRes.ok;
    notifyDuplicate = !!notifyRes.duplicate;
    notifyError = notifyRes.error ?? null;

$2
'@
  $content = ReplaceRegexExactlyOnce $content $pat $rep "INSERT_NOTIFY_CALL"
  Write-Host "[OK] Inserted notify call"
}

# ---------------------------------------------------
# 4) Extend success JSON with notify fields
# ---------------------------------------------------
if ($content.IndexOf("notify_ok: notifyOk,") -ge 0) {
  Write-Host "[OK] success JSON already contains notify fields"
} else {
  if ($content.IndexOf("assign_ok: true,") -ge 0) {
    $content = ReplaceLiteralOnce $content "      assign_ok: true," @'
      assign_ok: true,
      notify_ok: notifyOk,
      notify_duplicate: notifyDuplicate,
      notify_error: notifyError,
'@ "EXTEND_SUCCESS_JSON_AFTER_ASSIGN_OK"
    Write-Host "[OK] Extended success JSON after assign_ok"
  } elseif ($content.IndexOf("      ok: true,") -ge 0) {
    $content = ReplaceLiteralOnce $content "      ok: true," @'
      ok: true,
      notify_ok: notifyOk,
      notify_duplicate: notifyDuplicate,
      notify_error: notifyError,
'@ "EXTEND_SUCCESS_JSON_AFTER_OK"
    Write-Host "[OK] Extended success JSON after ok"
  } else {
    Fail "PATCH FAIL (EXTEND_SUCCESS_JSON): could not find ok: true or assign_ok: true anchor."
  }
}

WriteTextUtf8NoBom $assignPath $content
Write-Host "[OK] Patched: $assignPath"

Write-Host "`n== PATCH COMPLETE ==" -ForegroundColor Green
Write-Host "Next:"
Write-Host "  1) npm run build"
Write-Host "  2) create ONE new booking"
Write-Host "  3) query driver_notifications for d41 again"
Write-Host "  4) (optional) check /api/dispatch/assign JSON includes notify_ok fields"