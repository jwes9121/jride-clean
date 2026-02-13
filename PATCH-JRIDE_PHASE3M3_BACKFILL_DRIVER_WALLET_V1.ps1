# PATCH-JRIDE_PHASE3M3_BACKFILL_DRIVER_WALLET_V1.ps1
# Backfills missing driver wallet credits ONLY when expected payout > 0
# Idempotent: skips if a credit-like tx already exists for booking_id
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
$dir  = Join-Path $root "app\api\admin\reconcile-wallets\fix"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$target = Join-Path $dir "route.ts"

$code = @'
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function n(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function s(v: any) {
  return String(v ?? "").trim();
}

function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;

  return createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isCreditTx(t: any) {
  if (!(n(t.amount) > 0)) return false;
  const r = s(t.reason).toLowerCase();
  return r.includes("credit") || r.includes("earning") || r.includes("backfill");
}

export async function POST(req: NextRequest) {
  try {
    const admin = getAdmin();
    if (!admin) {
      return json(500, { ok:false, code:"SERVER_MISCONFIG" });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.mode === "dry_run";

    // Fetch completed bookings with expected payout > 0
    const { data: bookings, error: bErr } = await admin
      .from("bookings")
      .select("id,booking_code,driver_id,driver_payout,verified_fare,company_cut")
      .eq("status","completed");

    if (bErr) return json(500, { ok:false, stage:"bookings", message:bErr.message });

    let actions:any[] = [];

    for (const b of bookings || []) {
      if (!b.driver_id) continue;

      const expected =
        n(b.driver_payout) > 0
          ? n(b.driver_payout)
          : Math.max(n(b.verified_fare) - n(b.company_cut), 0);

      if (!(expected > 0)) continue;

      const { data: tx } = await admin
        .from("driver_wallet_transactions")
        .select("id,amount,reason")
        .eq("booking_id", b.id);

      const hasCredit = (tx || []).some(isCreditTx);
      if (hasCredit) continue;

      actions.push({
        booking_id: b.id,
        booking_code: b.booking_code,
        driver_id: b.driver_id,
        amount: expected
      });

      if (!dryRun) {
        await admin.from("driver_wallet_transactions").insert({
          driver_id: b.driver_id,
          booking_id: b.id,
          amount: expected,
          reason: "reconcile_backfill " + (b.booking_code || "")
        });
      }
    }

    return json(200, {
      ok: true,
      mode: dryRun ? "dry_run" : "apply",
      backfilled_count: actions.length,
      actions
    });

  } catch (e:any) {
    return json(500, { ok:false, error:String(e?.message || e) });
  }
}
'@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $code, $utf8NoBom)

Ok "[OK] Wrote: $target"
Ok "DONE"
