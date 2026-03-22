param(
  [Parameter(Mandatory = $true)]
  [string]$WebRoot
)

$ErrorActionPreference = "Stop"

function Write-Ok($msg) { Write-Host $msg -ForegroundColor Green }
function Write-Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function Ensure-Dir([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Backup-And-Write {
  param(
    [string]$Path,
    [string]$Content,
    [string]$Tag
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Target file not found: $Path"
  }

  $bakDir = Join-Path (Split-Path -Parent $Path) "_patch_bak"
  Ensure-Dir $bakDir

  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = Join-Path $bakDir ((Split-Path $Path -Leaf) + ".bak." + $Tag + "." + $stamp)
  Copy-Item -LiteralPath $Path -Destination $bak -Force
  Write-Ok "[OK] Backup: $bak"

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
  Write-Ok "[OK] Patched: $Path"
}

$pingFile  = Join-Path $WebRoot "app\api\driver\location\ping\route.ts"
$retryFile = Join-Path $WebRoot "app\api\dispatch\retry-auto-assign\route.ts"
$autoFile  = Join-Path $WebRoot "app\api\dispatch\auto-assign\route.ts"

$pingContent = Get-Content -LiteralPath $pingFile -Raw -Encoding UTF8
$retryContent = Get-Content -LiteralPath $retryFile -Raw -Encoding UTF8
$autoContent = Get-Content -LiteralPath $autoFile -Raw -Encoding UTF8

if ($pingContent -notmatch '\[DISPATCH_TRACE\] ping') {
  $pingContent = $pingContent -replace 'export async function POST\(req: Request\) \{', @'
export async function POST(req: Request) {
  const __trace_started_at = new Date().toISOString();
  console.log("[DISPATCH_TRACE] ping:start", { at: __trace_started_at });
'@
}

if ($pingContent -notmatch 'ping:upsert_result') {
  $pingContent = $pingContent -replace 'const becameOnline = previousStatus !== "online" && status === "online";', @'
    console.log("[DISPATCH_TRACE] ping:upsert_result", {
      driver_id,
      previous_status: previousStatus || null,
      current_status: status,
      coords_source: typeof coordsSource !== "undefined" ? coordsSource : null
    });

    const becameOnline = previousStatus !== "online" && status === "online";
'@
}

if ($pingContent -notmatch 'ping:retry_result') {
  $pingContent = $pingContent -replace 'return json\(200, \{', @'
    console.log("[DISPATCH_TRACE] ping:retry_result", {
      driver_id,
      became_online: becameOnline,
      retry_triggered: !!(retryResult?.attempted),
      retry_ok: !!(retryResult?.ok),
      retry_status: retryResult?.status ?? null
    });

    return json(200, {
'@
}

if ($retryContent -notmatch '\[DISPATCH_TRACE\] retry:start') {
  $retryContent = $retryContent -replace 'export async function POST\(\) \{', @'
export async function POST() {
  console.log("[DISPATCH_TRACE] retry:start", { at: new Date().toISOString() });
'@
}

if ($retryContent -notmatch 'retry:auto_assign_response') {
  $retryContent = $retryContent -replace 'return NextResponse\.json\(\{ ok: true, result: json \}\);', @'
    console.log("[DISPATCH_TRACE] retry:auto_assign_response", {
      ok: true,
      auto_assign_ok: json?.ok ?? null,
      mode: json?.mode ?? null,
      assigned_count: json?.assigned_count ?? null,
      skipped_count: json?.skipped_count ?? null,
      blocked_count: json?.blocked_count ?? null
    });
    return NextResponse.json({ ok: true, result: json });
'@
}

if ($retryContent -notmatch 'retry:error') {
  $retryContent = $retryContent -replace 'return NextResponse\.json\(\{ ok: false, error: String\(e\?\.message \|\| e\) \}, \{ status: 500 \}\);', @'
    console.error("[DISPATCH_TRACE] retry:error", {
      message: String(e?.message || e)
    });
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
'@
}

if ($autoContent -notmatch '\[DISPATCH_TRACE\] auto_assign:start') {
  $autoContent = $autoContent -replace 'export async function POST\(req: Request\) \{', @'
export async function POST(req: Request) {
  console.log("[DISPATCH_TRACE] auto_assign:start", { at: new Date().toISOString() });
'@
}

if ($autoContent -notmatch 'auto_assign:scan_summary') {
  $autoContent = $autoContent -replace 'return json\(\{', @'
      console.log("[DISPATCH_TRACE] auto_assign:scan_summary", {
        mode: "scan_requested",
        scanned_bookings_count,
        assigned_count,
        skipped_count,
        blocked_count
      });

      return json({
'@
}

if ($autoContent -notmatch 'auto_assign:single_result') {
  $autoContent = $autoContent -replace 'const result = await matchSingle\(supabase, booking as BookingRow\);', @'
    const result = await matchSingle(supabase, booking as BookingRow);
    console.log("[DISPATCH_TRACE] auto_assign:single_result", {
      booking_id: booking.id,
      booking_code: booking.booking_code ?? null,
      decision: result.decision,
      reason: result.reason ?? null,
      driver_id: result.driver_id ?? null,
      debug: result.debug
    });
'@
}

Backup-And-Write -Path $pingFile -Content $pingContent -Tag "TRACE_ONLY_V1"
Backup-And-Write -Path $retryFile -Content $retryContent -Tag "TRACE_ONLY_V1"
Backup-And-Write -Path $autoFile -Content $autoContent -Tag "TRACE_ONLY_V1"

Write-Host ""
Write-Info "TRACE PATCH COMPLETE"
Write-Host "After deploy, reproduce exactly one cycle and filter Vercel Logs for: [DISPATCH_TRACE]" -ForegroundColor Yellow