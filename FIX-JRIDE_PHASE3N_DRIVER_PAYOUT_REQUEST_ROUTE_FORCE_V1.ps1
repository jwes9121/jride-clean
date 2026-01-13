# FIX-JRIDE_PHASE3N_DRIVER_PAYOUT_REQUEST_ROUTE_FORCE_V1.ps1
# Force-create /api/driver/payout-request with GET+POST JSON, so no more 405/HTML shell.
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
function s(v: any) { return String(v ?? "").trim(); }
function n(v: any) { const x = Number(v); return Number.isFinite(x) ? x : 0; }

function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function minPayout() {
  const v = n(process.env.DRIVER_PAYOUT_MIN);
  return v > 0 ? v : 250;
}

// DIAGNOSTIC GET: proves route exists + deployed
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return json(200, {
    ok: true,
    route: "/api/driver/payout-request",
    methods: ["GET", "POST"],
    hint_get: "GET ?driver_id=UUID&limit=20",
    hint_post: "POST { driver_id, amount, note? }",
    echo: {
      driver_id: searchParams.get("driver_id"),
      limit: searchParams.get("limit"),
    },
    min_payout_default: 250,
    min_payout_env: process.env.DRIVER_PAYOUT_MIN ?? null,
  });
}

export async function POST(req: NextRequest) {
  const admin = getAdmin();
  if (!admin) return json(500, { ok: false, code: "SERVER_MISCONFIG", message: "Missing SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => ({} as any));
  const driver_id = s(body.driver_id);
  const amount = n(body.amount);
  const note = s(body.note);

  if (!driver_id) return json(400, { ok: false, code: "MISSING_DRIVER_ID" });
  if (!(amount > 0)) return json(400, { ok: false, code: "BAD_AMOUNT" });

  const min = minPayout();
  if (amount < min) return json(400, { ok: false, code: "BELOW_MIN", min_payout: min });

  const { data: balRow, error: balErr } = await admin
    .from("driver_wallet_balances_v1")
    .select("balance")
    .eq("driver_id", driver_id)
    .maybeSingle();

  if (balErr) return json(500, { ok: false, code: "DB_ERROR", stage: "balance", message: balErr.message });

  const balance = n((balRow as any)?.balance);
  if (amount > balance) return json(400, { ok: false, code: "INSUFFICIENT_BALANCE", balance, requested: amount });

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

  return json(200, { ok: true, request: ins, balance_at_request_time: balance, min_payout: min });
}
'@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $code, $utf8NoBom)

Ok "[OK] Wrote: $target"
Ok "DONE"
