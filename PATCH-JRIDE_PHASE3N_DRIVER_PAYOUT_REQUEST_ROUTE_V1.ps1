# PATCH-JRIDE_PHASE3N_DRIVER_PAYOUT_REQUEST_ROUTE_V1.ps1
# Adds driver payout request route:
#   app/api/driver/payout-request/route.ts
# POST creates payout request with minimum + balance enforcement
# GET lists payout requests for a driver_id
# UTF-8 without BOM

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }

function Find-RepoRoot([string]$startDir) {
  $d = Resolve-Path $startDir
  while ($true) {
    if (Test-Path (Join-Path $d "package.json")) { return $d }
    $parent = Split-Path $d -Parent
    if ($parent -eq $d) { break }
    $d = $parent
  }
  Fail "Could not find repo root (package.json)."
}

$root = Find-RepoRoot (Get-Location).Path
$dir  = Join-Path $root "app\api\driver\payout-request"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$target = Join-Path $dir "route.ts"
if (Test-Path $target) {
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  Copy-Item $target "$target.bak.$ts" -Force
  Ok "[OK] Backup: $target.bak.$ts"
}

$code = @'
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function s(v: any) {
  return String(v ?? "").trim();
}

function n(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;

  return createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function minPayout() {
  const v = n(process.env.DRIVER_PAYOUT_MIN);
  return v > 0 ? v : 250;
}

// GET /api/driver/payout-request?driver_id=...
export async function GET(req: NextRequest) {
  const admin = getAdmin();
  if (!admin) return json(500, { ok: false, code: "SERVER_MISCONFIG" });

  const { searchParams } = new URL(req.url);
  const driver_id = s(searchParams.get("driver_id"));
  const limit = Math.min(Math.max(parseInt(s(searchParams.get("limit") ?? "50"), 10) || 50, 1), 200);

  if (!driver_id) return json(400, { ok: false, code: "MISSING_DRIVER_ID" });

  const { data, error } = await admin
    .from("driver_payout_requests")
    .select("*")
    .eq("driver_id", driver_id)
    .order("requested_at", { ascending: false })
    .limit(limit);

  if (error) return json(500, { ok: false, code: "DB_ERROR", message: error.message });

  return json(200, { ok: true, driver_id, min_payout: minPayout(), rows: data ?? [] });
}

// POST body: { driver_id: uuid, amount: number, note?: string }
export async function POST(req: NextRequest) {
  const admin = getAdmin();
  if (!admin) return json(500, { ok: false, code: "SERVER_MISCONFIG" });

  const body = await req.json().catch(() => ({}));
  const driver_id = s(body.driver_id);
  const amount = n(body.amount);
  const note = s(body.note);

  if (!driver_id) return json(400, { ok: false, code: "MISSING_DRIVER_ID" });
  if (!(amount > 0)) return json(400, { ok: false, code: "BAD_AMOUNT" });

  const min = minPayout();
  if (amount < min) {
    return json(400, { ok: false, code: "BELOW_MIN", min_payout: min });
  }

  // Current balance from view (exists in your schema)
  const { data: balRow, error: balErr } = await admin
    .from("driver_wallet_balances_v1")
    .select("balance")
    .eq("driver_id", driver_id)
    .maybeSingle();

  if (balErr) return json(500, { ok: false, code: "DB_ERROR", stage: "balance", message: balErr.message });

  const balance = n((balRow as any)?.balance);
  if (amount > balance) {
    return json(400, { ok: false, code: "INSUFFICIENT_BALANCE", balance, requested: amount });
  }

  // Insert payout request
  const nowIso = new Date().toISOString();
  const { data: ins, error: insErr } = await admin
    .from("driver_payout_requests")
    .insert({
      driver_id,
      amount,
      status: "pending",
      requested_at: nowIso,
      admin_note: note || null,
    })
    .select("*")
    .maybeSingle();

  if (insErr) return json(500, { ok: false, code: "DB_ERROR", stage: "insert", message: insErr.message });

  return json(200, {
    ok: true,
    request: ins,
    min_payout: min,
    balance_at_request_time: balance,
  });
}
'@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $code, $utf8NoBom)

Ok "[OK] Wrote: $target"
Ok "DONE"
