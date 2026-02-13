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

// credit-like means: positive amount AND reason suggests earnings/credit/backfill
function isCreditTx(t: any) {
  const amt = n(t?.amount);
  if (!(amt > 0)) return false;
  const r = s(t?.reason).toLowerCase();
  return r.includes("credit") || r.includes("earning") || r.includes("earnings") || r.includes("backfill") || r.includes("reconcile");
}

// expected payout logic (matches reconcile-wallets route)
function expectedDriverPayout(b: any) {
  const dp = n(b?.driver_payout);
  if (dp > 0) return dp;
  const vf = n(b?.verified_fare);
  const cc = n(b?.company_cut);
  const est = vf - cc;
  return est > 0 ? est : 0;
}

// Optional GET so you can open it in browser and confirm route is deployed
export async function GET() {
  return json(200, {
    ok: true,
    message: "POST { mode: 'dry_run'|'apply' } to backfill missing driver credits (expected payout > 0).",
  });
}

type FixReq = {
  mode?: "dry_run" | "apply" | string | null;
  limit?: number | null;
};

export async function POST(req: NextRequest) {
  try {
    const admin = getAdmin();
    if (!admin) {
      return json(500, {
        ok: false,
        code: "SERVER_MISCONFIG",
        message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const body = (await req.json().catch(() => ({}))) as FixReq;
    const mode = s(body.mode || "dry_run").toLowerCase();
    const dryRun = mode !== "apply";
    const limit = Math.min(Math.max(parseInt(String(body.limit ?? "500"), 10) || 500, 1), 2000);

    // Pull completed bookings with fields needed to compute expected payout
    const { data: bookings, error: bErr } = await admin
      .from("bookings")
      .select("id,booking_code,status,driver_id,driver_payout,verified_fare,company_cut")
      .eq("status", "completed")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (bErr) return json(500, { ok: false, code: "DB_ERROR", stage: "bookings", message: bErr.message });

    const completed = bookings || [];

    const actions: any[] = [];
    let applied = 0;
    let skipped_existing = 0;
    let skipped_zero = 0;
    let skipped_no_driver = 0;
    let failed = 0;

    for (const b of completed) {
      if (!b.driver_id) { skipped_no_driver++; continue; }

      const expected = expectedDriverPayout(b);
      if (!(expected > 0)) { skipped_zero++; continue; }

      // Does a credit-like tx already exist for this booking?
      const { data: tx, error: txErr } = await admin
        .from("driver_wallet_transactions")
        .select("id,amount,reason")
        .eq("booking_id", b.id);

      if (txErr) {
        failed++;
        actions.push({ booking_id: b.id, booking_code: b.booking_code, status: "error_tx_lookup", error: txErr.message });
        continue;
      }

      const hasCredit = (tx || []).some(isCreditTx);
      if (hasCredit) { skipped_existing++; continue; }

      // Fetch current balance (view exists in your schema)
      const { data: balRow, error: balErr } = await admin
        .from("driver_wallet_balances_v1")
        .select("balance")
        .eq("driver_id", b.driver_id)
        .maybeSingle();

      if (balErr) {
        failed++;
        actions.push({ booking_id: b.id, booking_code: b.booking_code, status: "error_balance_lookup", error: balErr.message });
        continue;
      }

      const curBal = n((balRow as any)?.balance);
      const balance_after = curBal + expected;

      const planned = {
        booking_id: b.id,
        booking_code: b.booking_code ?? null,
        driver_id: b.driver_id,
        amount: expected,
        balance_before: curBal,
        balance_after,
        reason: "reconcile_backfill " + s(b.booking_code || ""),
      };

      if (dryRun) {
        actions.push({ ...planned, status: "would_insert" });
        continue;
      }

      const nowIso = new Date().toISOString();
      const { error: insErr } = await admin.from("driver_wallet_transactions").insert({
        driver_id: b.driver_id,
        booking_id: b.id,
        amount: expected,
        balance_after,
        reason: planned.reason,
        created_at: nowIso,
      });

      if (insErr) {
        failed++;
        actions.push({ ...planned, status: "insert_failed", error: insErr.message });
      } else {
        applied++;
        actions.push({ ...planned, status: "inserted" });
      }
    }

    return json(200, {
      ok: true,
      mode: dryRun ? "dry_run" : "apply",
      summary: {
        scanned_completed: completed.length,
        applied,
        failed,
        skipped_no_driver,
        skipped_zero_expected: skipped_zero,
        skipped_existing_credit: skipped_existing,
      },
      actions,
    });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: String(e?.message || e || "Unknown") });
  }
}