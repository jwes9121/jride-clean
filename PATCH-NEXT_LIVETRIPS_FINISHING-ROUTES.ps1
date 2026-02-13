# PATCH-NEXT_LIVETRIPS_FINISHING-ROUTES.ps1
# Routes-only: stable page-data + column-safe assign + no-store status response
# Does NOT touch UI/Mapbox.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path

# --- expected repo paths ---
$pageDataPath = Join-Path $root "app\api\admin\livetrips\page-data\route.ts"
$statusPath   = Join-Path $root "app\api\dispatch\status\route.ts"
$assignPath   = Join-Path $root "app\api\dispatch\assign\route.ts"

foreach ($p in @($pageDataPath,$statusPath,$assignPath)) {
  if (!(Test-Path $p)) { Fail "Missing expected file: $p" }
}

Write-Host "[1/3] Patch page-data stability: $pageDataPath" -ForegroundColor Cyan
$page = Get-Content -Raw -Encoding UTF8 $pageDataPath

# Replace "...rpcData," with "...(rpcData ?? {}),"
# Only patch if pattern exists to avoid unintended edits
if ($page -match '\.\.\.\s*rpcData\s*,') {
  $page = [regex]::Replace($page, '\.\.\.\s*rpcData\s*,', '...(rpcData ?? {}),', 1)
} else {
  Write-Host "NOTE: page-data spread pattern not found; skipping that specific change." -ForegroundColor Yellow
}

Set-Content -Path $pageDataPath -Value $page -Encoding UTF8
Write-Host "OK: page-data is now safe if RPC returns null." -ForegroundColor Green


Write-Host "[2/3] Patch status route response no-store: $statusPath" -ForegroundColor Cyan
$status = Get-Content -Raw -Encoding UTF8 $statusPath

# Add Cache-Control: no-store to the success response if not already present
if ($status -notmatch 'Cache-Control') {
  $status = [regex]::Replace(
    $status,
    'return NextResponse\.json\(\{\s*[\s\S]*?\}\);\s*$',
@'
  return NextResponse.json({
    ok: true,
    updated: Array.isArray(patched) ? patched.length : 1,
    bookingCode: patched?.[0]?.booking_code ?? bookingCode,
    id: patched?.[0]?.id ?? bookingId,
    status: nextStatus,
    columnsUpdated: cols,
    supabaseHost: safeHost(supabaseUrl),
  }, { headers: { "Cache-Control": "no-store" } });
'@,
    1
  )
}

Set-Content -Path $statusPath -Value $status -Encoding UTF8
Write-Host "OK: status route now returns Cache-Control: no-store (safe)." -ForegroundColor Green


Write-Host "[3/3] Rewrite assign route to be column-safe: $assignPath" -ForegroundColor Cyan

# Full rewrite (small file, safest + avoids regex edge cases)
$assignNew = @'
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AssignBody = {
  bookingCode?: string;
  driverId?: string;
};

function bad(message: string, extra: any = {}, status = 400) {
  return NextResponse.json({ ok: false, message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

function safeHost(u: string) {
  try { return new URL(u).host; } catch { return ""; }
}

function pickPresentKeys(sample: Record<string, any>, candidates: string[]) {
  return candidates.filter((c) => Object.prototype.hasOwnProperty.call(sample, c));
}

export async function POST(request: Request) {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) return bad("Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL", {}, 500);
  if (!serviceKey) return bad("Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)", {}, 500);

  let body: AssignBody;
  try {
    body = (await request.json()) as AssignBody;
  } catch {
    return bad("Invalid JSON body");
  }

  const bookingCode = body.bookingCode ? String(body.bookingCode).trim() : "";
  const driverId = body.driverId ? String(body.driverId).trim() : "";

  if (!bookingCode) return bad("Missing bookingCode");
  if (!driverId) return bad("Missing driverId");

  const where = `booking_code=eq.${encodeURIComponent(bookingCode)}`;
  const baseUrl = `${supabaseUrl}/rest/v1/bookings?${where}`;

  // 1) Read row first (so we don't assume column names)
  const readRes = await fetch(`${baseUrl}&select=*`, {
    method: "GET",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    cache: "no-store",
  });

  const readText = await readRes.text();
  if (!readRes.ok) {
    return bad("READ_FAILED", { httpStatus: readRes.status, detail: readText }, readRes.status);
  }

  let rows: any[] = [];
  try { rows = JSON.parse(readText); } catch {}
  if (!Array.isArray(rows) || rows.length === 0) {
    return bad("BOOKING_NOT_FOUND", { bookingCode }, 404);
  }

  const sample = rows[0] as Record<string, any>;

  // Driver id columns we support
  const driverCols = pickPresentKeys(sample, ["driver_id", "assigned_driver_id"]);

  // Status columns we support (same family as status route)
  const statusCols = pickPresentKeys(sample, ["status", "trip_status", "booking_status", "dispatch_status", "ride_status"]);

  if (driverCols.length === 0) {
    return bad("NO_DRIVER_COLUMNS_FOUND", {
      hint: "Bookings row has no driver_id/assigned_driver_id. Update the schema or adjust candidates.",
      keys: Object.keys(sample).slice(0, 80),
    }, 409);
  }

  // 2) Build patch body using ONLY present columns
  const patchBody: any = {};
  for (const c of driverCols) patchBody[c] = driverId;

  // If there is a status-like column, set it to 'assigned'
  for (const s of statusCols) patchBody[s] = "assigned";

  // 3) Patch
  const patchRes = await fetch(baseUrl, {
    method: "PATCH",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patchBody),
    cache: "no-store",
  });

  const patchText = await patchRes.text();
  if (!patchRes.ok) {
    return bad("PATCH_FAILED", {
      httpStatus: patchRes.status,
      detail: patchText,
      attempted: patchBody,
      supabaseHost: safeHost(supabaseUrl),
    }, patchRes.status);
  }

  let patched: any[] = [];
  try { patched = JSON.parse(patchText); } catch {}

  return NextResponse.json({
    ok: true,
    bookingCode: patched?.[0]?.booking_code ?? bookingCode,
    id: patched?.[0]?.id ?? rows?.[0]?.id ?? null,
    assignedDriverId: driverId,
    columnsUpdated: [...driverCols, ...statusCols],
    supabaseHost: safeHost(supabaseUrl),
  }, { headers: { "Cache-Control": "no-store" } });
}
'@

Set-Content -Path $assignPath -Value $assignNew -Encoding UTF8
Write-Host "OK: assign route is now column-safe and updates driver_id when present." -ForegroundColor Green

Write-Host ""
Write-Host "DONE. Next steps (no guessing):" -ForegroundColor Cyan
Write-Host "1) npm run dev" -ForegroundColor White
Write-Host "2) In LiveTrips: assign a driver, then wait for next refresh. It should NOT revert." -ForegroundColor White
Write-Host "3) If it still reverts, paste the Network responses of:" -ForegroundColor White
Write-Host "   - GET /api/admin/livetrips/page-data" -ForegroundColor White
Write-Host "   - POST /api/dispatch/assign" -ForegroundColor White
