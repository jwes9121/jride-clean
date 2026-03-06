#requires -Version 5.1
<#
PATCH JRIDE WEB: exact driver_notifications helper for current assign route
PS5-safe, ASCII-only

Target:
- app\api\dispatch\assign\route.ts

What it does:
1) Replaces insertDriverNotificationBestEffort() with exact schema version:
   driver_id, type, message, is_read, created_at
2) Makes booking update also set driver_id
3) Keeps existing response fields: assign_ok, notify_ok, notify_duplicate, notify_error

This patch is matched to the current uploaded file shape.
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

function ReplaceRegexExactlyOnce($content, $pattern, $replacement, $label) {
  $opts = [System.Text.RegularExpressions.RegexOptions]::Singleline
  $re = New-Object System.Text.RegularExpressions.Regex($pattern, $opts)
  $m = $re.Matches($content)
  if ($m.Count -lt 1) {
    Fail "PATCH FAIL ($label): pattern not found."
  }
  if ($m.Count -gt 1) {
    Fail "PATCH FAIL ($label): pattern matched multiple times ($($m.Count)). Refuse to patch."
  }
  return $re.Replace($content, $replacement, 1)
}

Write-Host "== PATCH JRIDE WEB: exact driver_notifications helper for current assign route (V2 / PS5-safe) ==" -ForegroundColor Cyan
$root = (Resolve-Path -LiteralPath $ProjRoot).Path
Write-Host "Root: $root"

$bakDir = Join-Path $root "_patch_bak"
EnsureDir $bakDir

$assignPath = Join-Path $root "app\api\dispatch\assign\route.ts"
Write-Host "`n== PATCH: $assignPath ==" -ForegroundColor Yellow

$content = ReadText $assignPath
$bak = BackupFile $assignPath $bakDir "ASSIGN_ROUTE_EXACT_DRIVER_NOTIFICATIONS_V2"
Write-Host "[OK] Backup: $bak"

EnsureContains $content 'async function insertDriverNotificationBestEffort(' "HELPER_ANCHOR"
EnsureContains $content 'const patch: any = {' "PATCH_BLOCK_ANCHOR"
EnsureContains $content 'assigned_driver_id: chosenDriverId,' "ASSIGNED_DRIVER_ANCHOR"

# 1) Replace helper with exact-schema helper
$helperPattern = '(?s)async function insertDriverNotificationBestEffort\(\s*admin: any,\s*driverId: string,\s*booking: any\s*\): Promise<\{ ok: boolean; duplicate: boolean; error\?: string \| null \}> \{.*?\n\}'
$helperReplacement = @'
async function insertDriverNotificationBestEffort(
  admin: any,
  driverId: string,
  booking: any
): Promise<{ ok: boolean; duplicate: boolean; error?: string | null }> {
  const nowIso = new Date().toISOString();
  const bookingCode = String(booking?.booking_code ?? "").trim();
  const message = bookingCode
    ? ("New booking assigned: " + bookingCode)
    : "New booking assigned";

  // Duplicate check based on exact existing schema only
  try {
    const q: any = await admin
      .from("driver_notifications")
      .select("id")
      .eq("driver_id", driverId)
      .eq("type", "booking_assigned")
      .eq("message", message)
      .limit(1);

    const rows = Array.isArray(q?.data) ? q.data : [];
    if (rows.length > 0) {
      return { ok: true, duplicate: true, error: null };
    }
  } catch {}

  try {
    const ins: any = await admin
      .from("driver_notifications")
      .insert({
        driver_id: driverId,
        type: "booking_assigned",
        message,
        is_read: false,
        created_at: nowIso,
      })
      .select("id")
      .limit(1);

    if (ins?.error) {
      return { ok: false, duplicate: false, error: String(ins.error?.message || "INSERT_FAILED") };
    }

    return { ok: true, duplicate: false, error: null };
  } catch (e: any) {
    return { ok: false, duplicate: false, error: String(e?.message || e || "INSERT_FAILED") };
  }
}
'@
$content = ReplaceRegexExactlyOnce $content $helperPattern $helperReplacement "REPLACE_HELPER_WITH_EXACT_SCHEMA"
Write-Host "[OK] Replaced helper with exact-schema version"

# 2) Ensure booking update also sets driver_id
if ($content.IndexOf('      driver_id: chosenDriverId,') -ge 0) {
  Write-Host "[OK] booking patch already sets driver_id"
} else {
  $oldPatch = @'
    const patch: any = {
      status: "assigned",
      assigned_driver_id: chosenDriverId,
      assigned_at: new Date().toISOString(),
    };
'@

  $newPatch = @'
    const patch: any = {
      status: "assigned",
      driver_id: chosenDriverId,
      assigned_driver_id: chosenDriverId,
      assigned_at: new Date().toISOString(),
    };
'@
  $content = ReplaceLiteralOnce $content $oldPatch $newPatch "ADD_DRIVER_ID_TO_PATCH"
  Write-Host "[OK] Added driver_id to booking patch"
}

WriteTextUtf8NoBom $assignPath $content
Write-Host "[OK] Patched: $assignPath"

Write-Host "`n== PATCH COMPLETE ==" -ForegroundColor Green
Write-Host "Next:"
Write-Host "  1) npm run build"
Write-Host "  2) git add -A"
Write-Host "  3) git commit -m ""JRIDE: fix assign route to write exact driver_notifications schema"""
Write-Host "  4) git push"
Write-Host "  5) create one fresh booking"
Write-Host "  6) query public.driver_notifications again"