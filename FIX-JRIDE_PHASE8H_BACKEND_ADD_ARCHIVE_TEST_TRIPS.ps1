# FIX-JRIDE_PHASE8H_BACKEND_ADD_ARCHIVE_TEST_TRIPS.ps1
# Patches app\api\admin\livetrips\actions\route.ts which uses if(action===...) blocks (no switch/case)
# Adds ARCHIVE_TEST_TRIPS action.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Backup($p){
  if(!(Test-Path $p)){ Fail "Missing file: $p" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  Copy-Item $p "$p.bak.$ts" -Force
  Write-Host "[OK] Backup: $p.bak.$ts" -ForegroundColor Green
}
function ReadUtf8($p){
  $t = Get-Content $p -Raw -Encoding UTF8
  if($t.Length -gt 0 -and [int]$t[0] -eq 0xFEFF){ $t = $t.Substring(1) }
  return $t
}
function WriteUtf8NoBom($p,$t){
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $t, $utf8NoBom)
}
function ReplaceOnce($txt, $pattern, $replacement, $label){
  $m = [regex]::Match($txt, $pattern)
  if(-not $m.Success){ Fail "Could not patch: $label" }
  return [regex]::Replace($txt, $pattern, $replacement, 1)
}

$api = "app\api\admin\livetrips\actions\route.ts"
Backup $api
$txt = ReadUtf8 $api

# 1) Expand ActionName union
$txt = $txt -replace 'type\s+ActionName\s*=\s*"NUDGE_DRIVER"\s*\|\s*"REASSIGN_DRIVER"\s*\|\s*"AUTO_ASSIGN"\s*;',
                      'type ActionName = "NUDGE_DRIVER" | "REASSIGN_DRIVER" | "AUTO_ASSIGN" | "ARCHIVE_TEST_TRIPS";'

# 2) Expand allowed actions check
# Looks like: if (!action || !["NUDGE_DRIVER","REASSIGN_DRIVER","AUTO_ASSIGN"].includes(action)) {
$allowedPattern = '(?s)if\s*\(\s*!action\s*\|\|\s*!\s*\[\s*"NUDGE_DRIVER"\s*,\s*"REASSIGN_DRIVER"\s*,\s*"AUTO_ASSIGN"\s*\]\s*\.includes\(action\)\s*\)\s*\{'
$allowedReplacement = 'if (!action || !["NUDGE_DRIVER", "REASSIGN_DRIVER", "AUTO_ASSIGN", "ARCHIVE_TEST_TRIPS"].includes(action)) {'
$txt = ReplaceOnce $txt $allowedPattern $allowedReplacement "allowed actions includes()"

# 3) Insert handler block right after patch init + updated_at bump
# Anchor: line that bumps updated_at, e.g. if (can("updated_at")) patch.updated_at = ...
$anchor = '(?s)(const\s+patch:\s*Record<string,\s*any>\s*=\s*\{\};\s*[\r\n]+(\s*\/\/\s*always bump updated_at if it exists[\s\S]*?\r?\n\s*if\s*\(can\("updated_at"\)\)\s*patch\.updated_at\s*=\s*new Date\(\)\.toISOString\(\);\s*))'
if(-not [regex]::IsMatch($txt, $anchor)){
  # fallback anchor if comments differ
  $anchor = '(?s)(const\s+patch:\s*Record<string,\s*any>\s*=\s*\{\};\s*[\s\S]{0,200}?if\s*\(can\("updated_at"\)\)\s*patch\.updated_at\s*=\s*new Date\(\)\.toISOString\(\);\s*)'
}

$insert = @'
$1

  if (action === "ARCHIVE_TEST_TRIPS") {
    // Bulk cleanup: archive TEST-% trips still in active statuses.
    // If updated_at exists, only archive those older than 2 hours (avoid touching fresh tests).
    const active = ["pending", "assigned", "on_the_way", "arrived", "enroute", "on_trip"];

    const patch2: Record<string, any> = { status: "completed" };
    if (can("updated_at")) patch2.updated_at = new Date().toISOString();

    const q0 = supabase
      .from("bookings")
      .update(patch2)
      .ilike("booking_code", "TEST-%")
      .in("status", active);

    const q = can("updated_at")
      ? q0.lt("updated_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      : q0;

    const { error } = await q;
    if (error) {
      return NextResponse.json({ ok: false, code: "ARCHIVE_FAILED", message: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, action });
  }

'@

$txt = ReplaceOnce $txt $anchor $insert "insert ARCHIVE_TEST_TRIPS handler"

WriteUtf8NoBom $api $txt
Write-Host "[OK] Added ARCHIVE_TEST_TRIPS to actions route" -ForegroundColor Green
