# PATCH-JRIDE_WALLET_ADJUST_AND_AUDIT_ROUTES_V1.ps1
# Creates/overwrites:
# - app\api\wallet\transactions\route.ts
# - app\api\wallet\adjust\route.ts
# - app\api\wallet\audit\route.ts
# Includes backups for existing files.

$ErrorActionPreference = "Stop"

function Ensure-Dir($p) { if (!(Test-Path $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null } }
function Stamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
function Backup-IfExists($path) {
  if (Test-Path $path) {
    $bak = "$path.bak.$(Stamp)"
    Copy-Item $path $bak -Force
    Write-Host "[OK] Backup: $bak"
  }
}

$repo = (Get-Location).Path
Write-Host "== JRIDE Patch: Wallet Adjust + Audit Routes (V1) =="
Write-Host "Repo: $repo"

# ---------- (1) wallet/transactions route ----------
$txDir = Join-Path $repo "app\api\wallet\transactions"
Ensure-Dir $txDir
$txFile = Join-Path $txDir "route.ts"
Backup-IfExists $txFile

$txCode = @"
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function bad(message: string, code: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function ok(data: any = {}) {
  return NextResponse.json(
    { ok: true, ...data },
    { headers: { "Cache-Control": "no-store" } }
  );
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
function isNumericId(v: string) {
  return /^[0-9]+$/.test(String(v || "").trim());
}
function isIdOk(v: string) {
  return isUuid(v) || isNumericId(v);
}

async function fetchRowsWithSafeOrdering(table: string, key: string, id: string, limit: number) {
  const orderFields = ["created_at", "updated_at", "inserted_at", "occurred_at", "timestamp", "ts", "id"];

  for (let i = 0; i < orderFields.length; i++) {
    const field = orderFields[i];
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq(key, id)
      .order(field as any, { ascending: false })
      .limit(limit);

    if (!error) return { rows: data ?? [], orderedBy: field };

    const msg = String((error as any)?.message || "");
    const isMissingColumn =
      msg.toLowerCase().includes("does not exist") ||
      msg.toLowerCase().includes("unknown column") ||
      (msg.toLowerCase().includes("column") && msg.toLowerCase().includes("not found"));

    if (!isMissingColumn) return { rows: [], orderedBy: null as any, fatalError: msg };
  }

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq(key, id)
    .limit(limit);

  if (error) return { rows: [], orderedBy: null as any, fatalError: String((error as any)?.message || error) };
  return { rows: data ?? [], orderedBy: null };
}

async function fetchBalanceSafe(kind: "driver" | "vendor", id: string) {
  const rpcName = kind === "driver"
    ? "admin_get_driver_wallet_balance_v1"
    : "admin_get_vendor_wallet_balance_v1";

  const argSets =
    kind === "driver"
      ? [{ driver_id: id }, { p_driver_id: id }, { in_driver_id: id }, { _driver_id: id }]
      : [{ vendor_id: id }, { p_vendor_id: id }, { in_vendor_id: id }, { _vendor_id: id }];

  for (let i = 0; i < argSets.length; i++) {
    const { data, error } = await supabase.rpc(rpcName as any, argSets[i]);
    if (!error) return { balance: data ?? null, balanceError: null };
  }

  const last = await supabase.rpc(rpcName as any);
  if (!last.error) return { balance: last.data ?? null, balanceError: null };

  return { balance: null, balanceError: String(last.error?.message || last.error) };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const kindRaw = (url.searchParams.get("kind") || "").toLowerCase();
    const kind = kindRaw === "driver" || kindRaw === "vendor" ? kindRaw : null;
    const id = (url.searchParams.get("id") || "").trim();
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 20)));

    if (!kind) return bad("Missing/invalid kind", "BAD_KIND");
    if (!id || !isIdOk(id)) return bad("Missing/invalid id", "BAD_ID");

    const table = kind === "driver" ? "driver_wallet_transactions" : "vendor_wallet_transactions";
    const key = kind === "driver" ? "driver_id" : "vendor_id";

    const res = await fetchRowsWithSafeOrdering(table, key, id, limit);
    if ((res as any).fatalError) {
      return bad("Wallet tx fetch failed", "WALLET_TX_FETCH_FAILED", 500, { details: (res as any).fatalError });
    }

    const bal = await fetchBalanceSafe(kind as any, id);

    return ok({
      kind,
      id,
      orderedBy: res.orderedBy,
      balance: bal.balance,
      balanceError: bal.balanceError,
      rows: res.rows
    });
  } catch (e: any) {
    return bad("Unhandled error", "UNHANDLED", 500, { details: String(e?.message || e) });
  }
}
"@

Set-Content -Path $txFile -Value $txCode -Encoding UTF8
Write-Host "[OK] Wrote: $txFile"

# ---------- helpers ----------
function Require-AdminKeyIfConfigured($reqHeaders) {
  $expected = $env:ADMIN_API_KEY
  if ([string]::IsNullOrWhiteSpace($expected)) { return $true }
  $got = $reqHeaders["x-admin-key"]
  return ($got -eq $expected)
}

# ---------- (2) wallet/adjust route ----------
$adjDir = Join-Path $repo "app\api\wallet\adjust"
Ensure-Dir $adjDir
$adjFile = Join-Path $adjDir "route.ts"
Backup-IfExists $adjFile

$adjCode = @"
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function bad(message: string, code: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}
function ok(data: any = {}) {
  return NextResponse.json(
    { ok: true, ...data },
    { headers: { "Cache-Control": "no-store" } }
  );
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function requireAdminKey(req: Request) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return true; // open if not configured
  const got = req.headers.get("x-admin-key") || "";
  return got === expected;
}

export async function POST(req: Request) {
  try {
    if (!requireAdminKey(req)) return bad("Invalid admin key", "BAD_ADMIN_KEY", 401);

    const body = await req.json().catch(() => ({} as any));
    const mode = String(body?.mode || "").toLowerCase(); // topup | cashout
    const driver_id = String(body?.driver_id || "").trim();
    const amount = Number(body?.amount || 0);
    const reason = String(body?.reason || "").trim() || (mode === "cashout" ? "Driver Load Wallet Cashout (Manual Payout)" : "Manual Topup");
    const created_by = String(body?.created_by || "admin").trim() || "admin";
    const method = body?.method == null ? null : String(body.method).trim();
    const external_ref = body?.external_ref == null ? null : String(body.external_ref).trim();
    const request_id = body?.request_id ? String(body.request_id).trim() : null;

    if (!isUuid(driver_id)) return bad("Invalid driver_id UUID", "BAD_DRIVER_ID");
    if (!Number.isFinite(amount) || amount === 0) return bad("amount must be non-zero", "BAD_AMOUNT");

    // TOPUP: uses audited adjust directly (positive amount)
    if (!mode || mode === "topup") {
      const { data, error } = await supabase.rpc("admin_adjust_driver_wallet_audited" as any, {
        p_driver_id: driver_id,
        p_amount: amount,
        p_reason: reason,
        p_created_by: created_by,
        p_method: method,
        p_external_ref: external_ref,
        p_request_id: request_id
      } as any);

      if (error) return bad("RPC failed", "RPC_FAILED", 500, { details: error.message });
      return ok({ mode: "topup", result: data });
    }

    // CASHOUT: amount must be positive, function will deduct internally
    if (mode === "cashout") {
      if (amount < 0) return bad("cashout amount must be positive", "BAD_CASHOUT_AMOUNT");

      const { data, error } = await supabase.rpc("admin_driver_cashout_load_wallet" as any, {
        p_driver_id: driver_id,
        p_cashout_amount: amount,
        p_created_by: created_by,
        p_method: method,
        p_external_ref: external_ref,
        p_request_id: request_id
      } as any);

      if (error) return bad("RPC failed", "RPC_FAILED", 500, { details: error.message });
      return ok({ mode: "cashout", result: data });
    }

    return bad("Invalid mode. Use topup|cashout", "BAD_MODE");
  } catch (e: any) {
    return bad("Unhandled error", "UNHANDLED", 500, { details: String(e?.message || e) });
  }
}
"@

Set-Content -Path $adjFile -Value $adjCode -Encoding UTF8
Write-Host "[OK] Wrote: $adjFile"

# ---------- (3) wallet/audit route ----------
$auditDir = Join-Path $repo "app\api\wallet\audit"
Ensure-Dir $auditDir
$auditFile = Join-Path $auditDir "route.ts"
Backup-IfExists $auditFile

$auditCode = @"
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function bad(message: string, code: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}
function ok(data: any = {}) {
  return NextResponse.json(
    { ok: true, ...data },
    { headers: { "Cache-Control": "no-store" } }
  );
}
function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
function requireAdminKey(req: Request) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return true;
  const got = req.headers.get("x-admin-key") || "";
  return got === expected;
}

export async function GET(req: Request) {
  try {
    if (!requireAdminKey(req)) return bad("Invalid admin key", "BAD_ADMIN_KEY", 401);

    const url = new URL(req.url);
    const driver_id = String(url.searchParams.get("driver_id") || "").trim();
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 50)));

    if (!isUuid(driver_id)) return bad("Invalid driver_id UUID", "BAD_DRIVER_ID");

    // wallet_admin_audit table exists in your schema list
    // Safe ordering: created_at desc (it exists)
    const { data, error } = await supabase
      .from("wallet_admin_audit")
      .select("*")
      .eq("driver_id", driver_id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return bad("Audit fetch failed", "AUDIT_FETCH_FAILED", 500, { details: error.message });

    return ok({ driver_id, rows: data ?? [] });
  } catch (e: any) {
    return bad("Unhandled error", "UNHANDLED", 500, { details: String(e?.message || e) });
  }
}
"@

Set-Content -Path $auditFile -Value $auditCode -Encoding UTF8
Write-Host "[OK] Wrote: $auditFile"

Write-Host "== DONE =="
Write-Host "Created routes:"
Write-Host " - app/api/wallet/transactions/route.ts"
Write-Host " - app/api/wallet/adjust/route.ts"
Write-Host " - app/api/wallet/audit/route.ts"
