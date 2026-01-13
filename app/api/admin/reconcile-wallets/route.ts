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

function isCreditTx(t: any) {
  // credit-like means: positive amount AND reason suggests earnings/credit
  const amt = n(t?.amount);
  if (!(amt > 0)) return false;
  const r = s(t?.reason).toLowerCase();
  return r.includes("credit") || r.includes("earning") || r.includes("earnings");
}

export async function GET(req: NextRequest) {
  try {
    const admin = getAdmin();
    if (!admin) {
      return json(500, {
        ok: false,
        code: "SERVER_MISCONFIG",
        message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "300", 10) || 300, 1000);

    // Pull fields needed to compute expected payout
    const { data: bookings, error: bErr } = await admin
      .from("bookings")
      .select("id,booking_code,status,service_type,vendor_status,driver_id,vendor_id,updated_at,driver_payout,verified_fare,company_cut")
      .eq("status", "completed")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (bErr) return json(500, { ok: false, code: "DB_ERROR", stage: "bookings", message: bErr.message });

    const completed = bookings || [];
    const completedIds = completed.map((x: any) => x.id).filter(Boolean);
    const completedCodes = completed.map((x: any) => x.booking_code).filter(Boolean);

    const { data: driverTx, error: dErr } = await admin
      .from("driver_wallet_transactions")
      .select("id,driver_id,amount,reason,booking_id,created_at")
      .in("booking_id", completedIds.length ? completedIds : ["00000000-0000-0000-0000-000000000000"])
      .order("created_at", { ascending: false })
      .limit(8000);

    if (dErr) return json(500, { ok: false, code: "DB_ERROR", stage: "driver_wallet_transactions", message: dErr.message });

    const { data: vendorTx, error: vErr } = await admin
      .from("vendor_wallet_transactions")
      .select("id,vendor_id,booking_code,amount,kind,note,created_at")
      .in("booking_code", completedCodes.length ? completedCodes : ["__none__"])
      .order("created_at", { ascending: false })
      .limit(8000);

    if (vErr) return json(500, { ok: false, code: "DB_ERROR", stage: "vendor_wallet_transactions", message: vErr.message });

    const { data: dBal, error: dBalErr } = await admin
      .from("driver_wallet_balances_v1")
      .select("driver_id,balance,last_tx_at,tx_count")
      .lt("balance", 0)
      .order("balance", { ascending: true })
      .limit(200);

    if (dBalErr) return json(500, { ok: false, code: "DB_ERROR", stage: "driver_wallet_balances_v1", message: dBalErr.message });

    const { data: vBal, error: vBalErr } = await admin
      .from("vendor_wallet_balances_v1")
      .select("vendor_id,balance,last_tx_at,tx_count")
      .lt("balance", 0)
      .order("balance", { ascending: true })
      .limit(200);

    if (vBalErr) return json(500, { ok: false, code: "DB_ERROR", stage: "vendor_wallet_balances_v1", message: vBalErr.message });

    // ---- Compute flags ----

    // Map booking_id -> credit-like driver tx
    const creditTxByBooking: Record<string, any[]> = {};
    for (const t of driverTx || []) {
      const bid = s((t as any).booking_id);
      if (!bid) continue;
      if (!isCreditTx(t)) continue;
      if (!creditTxByBooking[bid]) creditTxByBooking[bid] = [];
      creditTxByBooking[bid].push(t);
    }

    // Expected payout:
    // 1) driver_payout (if > 0)
    // 2) else max(verified_fare - company_cut, 0)
    function expectedDriverPayout(b: any) {
      const dp = n(b?.driver_payout);
      if (dp > 0) return dp;
      const vf = n(b?.verified_fare);
      const cc = n(b?.company_cut);
      const est = vf - cc;
      return est > 0 ? est : 0;
    }

    const missing_driver_credits = completed
      .filter((b: any) => !!b.driver_id)
      .map((b: any) => ({ b, expected: expectedDriverPayout(b) }))
      .filter((x: any) => x.expected > 0) // âœ… only flag when something is actually expected
      .filter((x: any) => {
        const bid = s(x.b.id);
        return !creditTxByBooking[bid] || creditTxByBooking[bid].length === 0;
      })
      .map((x: any) => ({
        booking_id: x.b.id,
        booking_code: x.b.booking_code ?? null,
        driver_id: x.b.driver_id ?? null,
        service_type: x.b.service_type ?? null,
        expected_driver_payout: x.expected,
        updated_at: x.b.updated_at ?? null,
      }))
      .slice(0, 500);

    const duplicate_driver_credits = Object.keys(creditTxByBooking)
      .filter((bid) => (creditTxByBooking[bid]?.length || 0) > 1)
      .map((bid) => ({
        booking_id: bid,
        count: creditTxByBooking[bid].length,
        tx: creditTxByBooking[bid].slice(0, 5),
      }))
      .slice(0, 300);

    // Vendor: only completed takeout vendor_status=completed, require earning kind
    const vtxByCode: Record<string, any[]> = {};
    for (const t of vendorTx || []) {
      const code = s((t as any).booking_code);
      if (!code) continue;
      if (!vtxByCode[code]) vtxByCode[code] = [];
      vtxByCode[code].push(t);
    }

    const takeoutCompleted = completed.filter((b: any) =>
      s(b.service_type).toLowerCase() === "takeout" &&
      s(b.vendor_status).toLowerCase() === "completed" &&
      !!b.vendor_id &&
      !!b.booking_code
    );

    const missing_vendor_credits = takeoutCompleted
      .filter((b: any) => {
        const code = s(b.booking_code);
        const list = vtxByCode[code] || [];
        return list.filter((t: any) => s(t.kind).toLowerCase() === "earning" && n(t.amount) > 0).length === 0;
      })
      .map((b: any) => ({
        booking_code: b.booking_code,
        booking_id: b.id,
        vendor_id: b.vendor_id ?? null,
        vendor_status: b.vendor_status ?? null,
        updated_at: b.updated_at ?? null,
      }))
      .slice(0, 500);

    const duplicate_vendor_earnings = Object.keys(vtxByCode)
      .map((code) => {
        const earnings = (vtxByCode[code] || []).filter((t: any) => s(t.kind).toLowerCase() === "earning" && n(t.amount) > 0);
        return { code, earnings };
      })
      .filter((x) => x.earnings.length > 1)
      .map((x) => ({
        booking_code: x.code,
        count: x.earnings.length,
        tx: x.earnings.slice(0, 5),
      }))
      .slice(0, 300);

    const summary = {
      completed_count: completed.length,
      completed_takeout_vendor_completed_count: takeoutCompleted.length,
      driver_tx_seen: (driverTx || []).length,
      vendor_tx_seen: (vendorTx || []).length,

      // updated metrics:
      missing_driver_credits_count: missing_driver_credits.length,
      duplicate_driver_credit_tx_count: duplicate_driver_credits.length,

      missing_vendor_credits_count: missing_vendor_credits.length,
      duplicate_vendor_earnings_count: duplicate_vendor_earnings.length,

      negative_driver_balances_count: (dBal || []).length,
      negative_vendor_balances_count: (vBal || []).length,
    };

    return json(200, {
      ok: true,
      summary,
      missing_driver_credits,
      duplicate_driver_credits,
      missing_vendor_credits,
      duplicate_vendor_earnings,
      negative_driver_balances: dBal || [],
      negative_vendor_balances: vBal || [],
      note: "Driver missing/duplicate now based on expected payout > 0 and credit-like tx only.",
    });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: String(e?.message || e || "Unknown") });
  }
}