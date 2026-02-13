# PATCH-JRIDE_VENDOR_CORE_V2_ADD_POST_TRANSITIONS.ps1
# Vendor Core V2: Add POST update with allowed transitions + idempotency
# File: app/api/vendor-orders/route.ts
# One file only. No gating.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$rel = "app\api\vendor-orders\route.ts"
$path = Join-Path (Get-Location).Path $rel
if (!(Test-Path $path)) { Fail "File not found: $path (run from repo root)" }

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

# Idempotency: if POST already exists, do nothing
if ($txt -match '(?m)^\s*export\s+async\s+function\s+POST\s*\(') {
  Info "POST already exists in vendor-orders route. No change."
  exit 0
}

# 1) Insert helpers (once) after: export const dynamic = ...
if ($txt -notmatch 'VENDOR_CORE_V2_TRANSITIONS') {
  $dynAnchor = '(?m)^\s*export\s+const\s+dynamic\s*=\s*"force-dynamic";\s*$'
  if ($txt -notmatch $dynAnchor) { Fail "Could not find export const dynamic = ""force-dynamic"";" }

  $helpers = @'

/* VENDOR_CORE_V2_TRANSITIONS
   Enforce allowed vendor status transitions
   Idempotent + safe (repeat same status OK)
*/
const VENDOR_FLOW = ["preparing","ready","driver_arrived","picked_up","completed"] as const;
type VendorStatus = typeof VENDOR_FLOW[number];

function isValidVendorStatus(s: any): s is VendorStatus {
  return VENDOR_FLOW.includes(s);
}

function normVendorStatus(s: any): VendorStatus {
  const v = String(s || "").trim();
  return (isValidVendorStatus(v) ? v : "preparing");
}

function canTransition(prev: VendorStatus, next: VendorStatus): boolean {
  if (prev === next) return true; // idempotent
  const pi = VENDOR_FLOW.indexOf(prev);
  const ni = VENDOR_FLOW.indexOf(next);
  return ni === pi + 1;
}

'@

  $txt = [regex]::Replace($txt, $dynAnchor, '$0' + "`r`n" + $helpers, 1)
  Ok "Inserted Vendor Core V2 helpers."
} else {
  Info "V2 helpers already present."
}

# 2) Insert POST handler after GET handler (right after the final closing brace of GET)
# Find end of GET by locating "export async function GET" then the last "}" before next export/EOF.
$idxGet = $txt.IndexOf("export async function GET")
if ($idxGet -lt 0) { Fail "GET handler not found." }

# Find the end of GET function by scanning braces from its first '{'
$startBrace = $txt.IndexOf("{", $idxGet)
if ($startBrace -lt 0) { Fail "GET opening brace not found." }

$depth = 0
$endPos = -1
for ($i = $startBrace; $i -lt $txt.Length; $i++) {
  $ch = $txt[$i]
  if ($ch -eq "{") { $depth++ }
  elseif ($ch -eq "}") {
    $depth--
    if ($depth -eq 0) { $endPos = $i; break }
  }
}
if ($endPos -lt 0) { Fail "Could not determine end of GET handler." }

# Insert immediately after the GET function closing brace
$postBlock = @'

export async function POST(req: Request) {
  const supabase = createRouteHandlerClient({ cookies });

  try {
    const body = (await req.json().catch(() => ({}))) as any;

    const order_id = String(body?.order_id || body?.id || "").trim();
    const vendor_id = String(body?.vendor_id || body?.vendorId || "").trim();
    const vendor_status_raw = String(body?.vendor_status || body?.status || "").trim();

    if (!order_id || !vendor_id || !vendor_status_raw) {
      return NextResponse.json(
        { ok: false, code: "INVALID_INPUT", message: "order_id, vendor_id, vendor_status required" },
        { status: 400 }
      );
    }

    if (!isValidVendorStatus(vendor_status_raw)) {
      return NextResponse.json(
        { ok: false, code: "INVALID_STATUS", message: "Invalid vendor_status" },
        { status: 400 }
      );
    }

    // Load current status (no assumptions beyond columns already used by GET)
    const { data: row, error: selErr } = await supabase
      .from("bookings")
      .select("id,vendor_id,vendor_status,booking_code,passenger_name,service_type,status,created_at,updated_at")
      .eq("id", order_id)
      .eq("vendor_id", vendor_id)
      .maybeSingle();

    if (selErr) {
      return NextResponse.json({ ok: false, code: "DB_ERROR", message: selErr.message }, { status: 500 });
    }

    if (!row) {
      return NextResponse.json(
        { ok: false, code: "NOT_FOUND", message: "Order not found for vendor" },
        { status: 404 }
      );
    }

    const current = normVendorStatus((row as any).vendor_status);
    const next = vendor_status_raw as VendorStatus;

    if (!canTransition(current, next)) {
      return NextResponse.json(
        { ok: false, code: "INVALID_TRANSITION", message: "Cannot transition vendor_status", current, next },
        { status: 409 }
      );
    }

    // Idempotent: if same, just return the row as-is
    if (current === next) {
      return NextResponse.json({
        ok: true,
        order: {
          id: row.id,
          booking_code: (row as any).booking_code,
          customer_name: (row as any).passenger_name,
          vendor_status: (row as any).vendor_status,
          service_type: (row as any).service_type,
          status: (row as any).status,
          created_at: (row as any).created_at,
          updated_at: (row as any).updated_at,
        },
      });
    }

    const { data: updated, error: updErr } = await supabase
      .from("bookings")
      .update({ vendor_status: next })
      .eq("id", order_id)
      .eq("vendor_id", vendor_id)
      .select("id,vendor_id,vendor_status,booking_code,passenger_name,service_type,status,created_at,updated_at")
      .maybeSingle();

    if (updErr) {
      return NextResponse.json({ ok: false, code: "DB_ERROR", message: updErr.message }, { status: 500 });
    }

    if (!updated) {
      return NextResponse.json(
        { ok: false, code: "UPDATE_FAILED", message: "Update failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      order: {
        id: updated.id,
        booking_code: (updated as any).booking_code,
        customer_name: (updated as any).passenger_name,
        vendor_status: (updated as any).vendor_status,
        service_type: (updated as any).service_type,
        status: (updated as any).status,
        created_at: (updated as any).created_at,
        updated_at: (updated as any).updated_at,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", message: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

'@

$txt = $txt.Substring(0, $endPos + 1) + $postBlock + $txt.Substring($endPos + 1)
Ok "Inserted POST handler with transitions + idempotency."

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Ok "Vendor Core V2 backend POST transitions applied."
