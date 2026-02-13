# PATCH-JRIDE_PHASE8F_PROBLEM_BADGES_AND_GUARDS.ps1
# Phase 8F: Explainable problem trips + guarded actions + real backend nudge

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Backup($p){
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  Copy-Item $p "$p.bak.$ts" -Force
  Write-Host "[OK] Backup: $p.bak.$ts" -ForegroundColor Green
}
function Read($p){
  $t = Get-Content $p -Raw -Encoding UTF8
  if($t.Length -gt 0 -and [int]$t[0] -eq 0xFEFF){ $t = $t.Substring(1) }
  return $t
}
function Write($p,$t){
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p,$t,$utf8NoBom)
}

# -------------------------------------------------------------------
# FRONTEND PATCH
# -------------------------------------------------------------------
$ui = "app\admin\livetrips\LiveTripsClient.tsx"
if(!(Test-Path $ui)){ Fail "Missing $ui" }
Backup $ui
$txt = Read $ui

# Add small badge renderer under computeProblemReason
if($txt -notmatch "function renderProblemBadge"){
$txt = $txt -replace "function computeIsProblem\(t: TripRow\): boolean \{\s*return !!computeProblemReason\(t\);\s*\}",
@"
function computeIsProblem(t: TripRow): boolean {
  return !!computeProblemReason(t);
}

function renderProblemBadge(t: TripRow) {
  const r = computeProblemReason(t);
  if (!r) return null;
  return (
    <span className="ml-2 inline-flex items-center rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">
      {r}
    </span>
  );
}
"@
}

# Inject badge + guarded buttons
$txt = $txt -replace
'\{computeIsProblem\(t\) && \(\s*<>[\s\S]*?<\/>\s*\)\}',
@"
{computeIsProblem(t) && (
  <>
    {renderProblemBadge(t)}

    <button
      onClick={() => callLiveTripsAction("NUDGE_DRIVER", t)}
      className="border px-2 rounded"
    >
      Nudge
    </button>

    <button
      disabled={!hasDriver(t)}
      title={!hasDriver(t) ? "No driver linked" : ""}
      onClick={() => callLiveTripsAction("REASSIGN_DRIVER", t)}
      className="border px-2 rounded disabled:opacity-40"
    >
      Reassign
    </button>

    <button
      disabled={!Number.isFinite(t.pickup_lat as any) || !Number.isFinite(t.dropoff_lat as any)}
      title="Requires pickup & dropoff coordinates"
      onClick={() => callLiveTripsAction("AUTO_ASSIGN", t)}
      className="border px-2 rounded disabled:opacity-40"
    >
      Auto-assign
    </button>
  </>
)}
"@

Write $ui $txt
Write-Host "[OK] UI patched (problem badges + guarded actions)" -ForegroundColor Green

# -------------------------------------------------------------------
# BACKEND PATCH
# -------------------------------------------------------------------
$api = "app\api\admin\livetrips\actions\route.ts"
if(!(Test-Path $api)){ Fail "Missing $api" }
Backup $api
$txt = Read $api

if($txt -notmatch "NUDGE_DRIVER"){
Fail "actions route does not contain expected handlers"
}

# Replace NUDGE_DRIVER logic
$txt = $txt -replace
'case\s+"NUDGE_DRIVER"[\s\S]*?break;',
@'
case "NUDGE_DRIVER": {
  // Touch updated_at so stuck watcher resets
  await supabase
    .from("bookings")
    .update({ updated_at: new Date().toISOString() })
    .eq("booking_code", booking_code);
  return NextResponse.json({ ok: true });
}
'@

# Harden REASSIGN_DRIVER
$txt = $txt -replace
'case\s+"REASSIGN_DRIVER"[\s\S]*?break;',
@'
case "REASSIGN_DRIVER": {
  const updates: any = { status: "assigned", updated_at: new Date().toISOString() };

  // Clear driver fields safely
  if ("driver_id" in booking) updates.driver_id = null;
  if ("assigned_driver_id" in booking) updates.assigned_driver_id = null;

  await supabase
    .from("bookings")
    .update(updates)
    .eq("booking_code", booking_code);

  return NextResponse.json({ ok: true });
}
'@

Write $api $txt
Write-Host "[OK] Backend patched (real nudge + safe reassign)" -ForegroundColor Green

Write-Host "`nPhase 8F patch applied successfully." -ForegroundColor Cyan
