# JRIDE LiveTrips - wire actions to API + refresh page-data + fix trip key mismatch
# - NO UI layout changes
# - PowerShell only
# - Creates timestamped backups before edits
# - IMPORTANT: This script does NOT write itself (avoids here-string nesting issues)

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Info($m) { Write-Host $m -ForegroundColor Cyan }
function Ok($m) { Write-Host $m -ForegroundColor Green }

$root = (Get-Location).Path
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

# ---- Expected paths (adjust ONLY if your repo differs) ----
$pathClient = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
$pathMap    = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"
$pathSmart  = Join-Path $root "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx"

$pathStatus = Join-Path $root "app\api\dispatch\status\route.ts"
$pathAssign = Join-Path $root "app\api\dispatch\assign\route.ts"
$pathPage   = Join-Path $root "app\api\admin\livetrips\page-data\route.ts"

# ---- Safety checks ----
foreach ($p in @($pathClient,$pathMap,$pathSmart,$pathStatus,$pathAssign,$pathPage)) {
  if (-not (Test-Path $p)) {
    Fail "Missing file: $p
Run this from repo root (where app\ exists)."
  }
}

# ---- Backup helper ----
function Backup-File($p) {
  $dir = Split-Path $p -Parent
  $name = Split-Path $p -Leaf
  $bak = Join-Path $dir ("_bak_{0}_{1}" -f $ts, $name)
  Copy-Item -Force $p $bak
  return $bak
}

Info "Backing up files..."
$bakClient = Backup-File $pathClient
$bakMap    = Backup-File $pathMap
$bakStatus = Backup-File $pathStatus
Ok "Backups created:"
Ok " - $bakClient"
Ok " - $bakMap"
Ok " - $bakStatus"

# ==========================================================
# 1) Overwrite /api/dispatch/status route with robust handler
#    - accepts bookingCode / booking_code / bookingId / booking_id
#    - validates statuses
#    - cache: no-store
# ==========================================================
Info "Writing robust dispatch status route..."

$dirStatus = Split-Path $pathStatus -Parent
if (-not (Test-Path $dirStatus)) { New-Item -ItemType Directory -Force -Path $dirStatus | Out-Null }

@'
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Body = {
  bookingId?: string | null;
  booking_id?: string | null;

  bookingCode?: string | null;
  booking_code?: string | null;

  status?: string | null;
  nextStatus?: string | null;

  override?: boolean | null;
  source?: string | null;
};

const ALLOWED = new Set([
  "pending",
  "assigned",
  "on_the_way",
  "on_trip",
  "completed",
  "cancelled",
]);

function norm(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function pickBodyId(b: Body) {
  const bookingId = String(b.bookingId ?? b.booking_id ?? "").trim();
  const bookingCode = String(b.bookingCode ?? b.booking_code ?? "").trim();
  return { bookingId, bookingCode };
}

function canTransition(fromS: string, toS: string, override: boolean) {
  if (override) return true;
  if (!fromS) return true;

  const from = norm(fromS);
  const to = norm(toS);

  if (from === to) return true;

  if (from === "assigned" && to === "on_the_way") return true;
  if (from === "on_the_way" && to === "on_trip") return true;
  if (from === "on_trip" && to === "completed") return true;

  if (to === "cancelled" && from !== "completed" && from !== "cancelled") return true;
  if (from === "pending" && to === "assigned") return true;

  return false;
}

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as Body;

    const { bookingId, bookingCode } = pickBodyId(body);
    const override = !!body.override;
    const source = String(body.source ?? "admin").trim();

    const toStatus = norm(body.status ?? body.nextStatus);
    if (!toStatus) {
      return NextResponse.json({ error: "MISSING_STATUS" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    if (!ALLOWED.has(toStatus)) {
      return NextResponse.json(
        { error: "INVALID_STATUS", message: Status '' not allowed. },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!bookingId && !bookingCode) {
      return NextResponse.json({ error: "MISSING_BOOKING_IDENTIFIER" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    let readQ = supabase.from("bookings").select("id, booking_code, status, driver_id, updated_at, created_at").limit(1);
    if (bookingId) readQ = readQ.eq("id", bookingId);
    else readQ = readQ.eq("booking_code", bookingCode);

    const { data: curRows, error: curErr } = await readQ;
    if (curErr) {
      console.error("DISPATCH_STATUS_READ_ERROR", curErr);
      return NextResponse.json(
        { error: "DISPATCH_STATUS_READ_ERROR", message: curErr.message },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const cur = (curRows ?? [])[0] as any;
    if (!cur?.id) {
      return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    const fromStatus = String(cur.status ?? "").trim();
    if (!canTransition(fromStatus, toStatus, override)) {
      return NextResponse.json(
        { error: "INVALID_TRANSITION", message: Cannot change status from '' to ''. },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }

    const nowIso = new Date().toISOString();

    const updatePayload: any = {
      status: toStatus,
      updated_at: nowIso,
    };

    const { data: updRows, error: updErr } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", String(cur.id))
      .select("id, booking_code, status, driver_id, updated_at")
      .limit(1);

    if (updErr) {
      console.error("DISPATCH_STATUS_DB_ERROR", updErr);
      return NextResponse.json(
        { error: "DISPATCH_STATUS_DB_ERROR", message: updErr.message },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const upd = (updRows ?? [])[0] as any;

    return NextResponse.json(
      {
        ok: true,
        bookingId: String(upd?.id ?? cur.id),
        bookingCode: String(upd?.booking_code ?? cur.booking_code ?? bookingCode ?? ""),
        fromStatus: fromStatus || null,
        toStatus,
        updatedAt: String(upd?.updated_at ?? nowIso),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("DISPATCH_STATUS_UNEXPECTED", err);
    return NextResponse.json(
      { error: "DISPATCH_STATUS_UNEXPECTED", message: err?.message ?? "Unexpected error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
'@ | Out-File -FilePath $pathStatus -Encoding utf8

Ok "Wrote: $pathStatus"

# ==========================================================
# 2) Patch LiveTripsClient.tsx
#    - Remove broken duplicate setTripStatus block (if present)
#    - Add cache-busting t= param to page-data fetch
# ==========================================================
Info "Patching LiveTripsClient.tsx..."

$client = Get-Content -Raw -LiteralPath $pathClient

# Remove block: // --- ACTIONS: ... const setTripStatus = async (...) => { ... };
$rxBroken = '(?s)(\r?\n)\s*//\s*---\s*ACTIONS:.*?const\s+setTripStatus\s*=\s*async\s*\(.*?\)\s*=>\s*\{.*?\}\s*;\s*(\r?\n)'
if ($client -match $rxBroken) {
  $client = [regex]::Replace($client, $rxBroken, "
")
  Ok "Removed broken/duplicate setTripStatus block."
} else {
  Info "No broken setTripStatus block found (ok)."
}

# Cache-bust page-data fetch
$rxFetch = 'fetch\(\s*["'']\/api\/admin\/livetrips\/page-data\?debug=1["'']\s*,\s*\{\s*cache:\s*["'']no-store["'']\s*\}\s*\)'
if ($client -match $rxFetch) {
  $client = [regex]::Replace(
    $client,
    $rxFetch,
    'fetch(/api/admin/livetrips/page-data?debug=1&t=, { cache: "no-store" })'
  )
  Ok "Added cache-busting t= param to page-data fetch."
} else {
  Info "Did not find exact page-data fetch pattern (skipping cache-bust patch)."
}

$client | Out-File -FilePath $pathClient -Encoding utf8
Ok "Patched: $pathClient"

# ==========================================================
# 3) Patch LiveTripsMap.tsx
#    - Unify trip key with client (uuid/id/booking_code/bookingCode)
#    - NO layout changes
# ==========================================================
Info "Patching LiveTripsMap.tsx..."

$map = Get-Content -Raw -LiteralPath $pathMap

$anchor = "function num(v: any): number | null {"
if ($map -notmatch [regex]::Escape("function tripKey(")) {
  $insert = @'
function tripKey(raw: any, fallbackIdx?: number): string {
  if (!raw) return String(fallbackIdx ?? "");
  const v =
    raw.uuid ??
    raw.id ??
    raw.booking_code ??
    raw.bookingCode ??
    raw.bookingcode ??
    raw.code ??
    null;
  const s = String(v ?? (fallbackIdx ?? "")).trim();
  return s;
}

'@
  $map = $map -replace [regex]::Escape($anchor), ($anchor + "

" + $insert)
  Ok "Inserted tripKey() helper."
} else {
  Info "tripKey() helper already exists (ok)."
}

# Common id patterns -> tripKey
$map = $map -replace 'String\(raw\.id\s*\?\?\s*raw\.bookingCode\s*\?\?\s*i\)', 'tripKey(raw, i)'
$map = $map -replace 'String\(tRaw\.id\s*\?\?\s*tRaw\.bookingCode\s*\?\?\s*""\)', 'tripKey(tRaw)'
$map = $map -replace 'String\(selectedTrip\.id\s*\?\?\s*selectedTrip\.bookingCode\s*\?\?\s*""\)', 'tripKey(selectedTrip)'
$map = $map -replace 'String\(t\.id\s*\?\?\s*t\.bookingCode\s*\?\?\s*""\)\s*===\s*selectedTripId', 'tripKey(t) === selectedTripId'

# Ensure panel id uses stable key
$map = $map -replace 'id:\s*String\(selectedTrip\.id\)', 'id: tripKey(selectedTrip)'

# bookingCode fallback (does not change UI)
$map = $map -replace 'selectedTrip\.bookingCode', '(selectedTrip.bookingCode ?? selectedTrip.booking_code)'

$map | Out-File -FilePath $pathMap -Encoding utf8
Ok "Patched: $pathMap"

Info "Done patching."
Write-Host "Next:" -ForegroundColor Yellow
Write-Host "  npm run dev" -ForegroundColor Yellow
Write-Host "  Open /admin/livetrips and click status buttons" -ForegroundColor Yellow
Write-Host "" -ForegroundColor Yellow
Ok "If anything breaks, restore backups:"
Write-Host "Copy-Item -Force "$bakClient" "$pathClient"" -ForegroundColor Yellow
Write-Host "Copy-Item -Force "$bakMap" "$pathMap"" -ForegroundColor Yellow
Write-Host "Copy-Item -Force "$bakStatus" "$pathStatus"" -ForegroundColor Yellow
