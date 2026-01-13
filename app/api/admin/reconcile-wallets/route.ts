import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;

  return createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function s(v: any) { return String(v ?? "").trim(); }

export async function GET(req: NextRequest) {
  try {
    const admin = getAdmin();
    if (!admin) {
      return json(500, {
        ok: false,
        error: "SERVER_MISCONFIG",
        message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1000);

    // 1) Completed bookings (basic fields only)
    const { data: bookings, error: bErr } = await admin
      .from("bookings")
      .select("id,booking_code,status,service_type,vendor_status,driver_id,vendor_id,completed_at,updated_at")
      .eq("status", "completed")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (bErr) {
      return json(500, { ok: false, error: "DB_ERROR", message: bErr.message, stage: "bookings" });
    }

    const completed = bookings || [];
    const completedIds = completed.map((x: any) => x.id).filter(Boolean);
    const completedCodes = completed.map((x: any) => x.booking_code).filter(Boolean);

    // 2) Driver wallet tx for those bookings (if table exists)
    let driverTx: any[] = [];
    const { data: dProbe } = await admin.from("driver_wallet_transactions").select("id").limit(1);
    if (Array.isArray(dProbe)) {
      const { data: dTx, error: dErr } = await admin
        .from("driver_wallet_transactions")
        .select("id,driver_id,amount,reason,booking_id,created_at")
        .in("booking_id", completedIds.length ? completedIds : ["00000000-0000-0000-0000-000000000000"])
        .order("created_at", { ascending: false })
        .limit(5000);

      if (dErr) {
        return json(500, { ok: false, error: "DB_ERROR", message: dErr.message, stage: "driver_wallet_transactions" });
      }
      driverTx = dTx || [];
    }

    // 3) Vendor wallet tx for those booking_codes (if table exists)
    let vendorTx: any[] = [];
    let vendorTxExists = false;
    try {
      const { data: vProbe, error: vProbeErr } = await admin.from("vendor_wallet_transactions").select("id").limit(1);
      vendorTxExists = !vProbeErr;
      if (vendorTxExists) {
        const { data: vTx, error: vErr } = await admin
          .from("vendor_wallet_transactions")
          .select("id,vendor_id,booking_code,amount,kind,note,created_at")
          .in("booking_code", completedCodes.length ? completedCodes : ["__none__"])
          .order("created_at", { ascending: false })
          .limit(5000);

        if (vErr) {
          return json(500, { ok: false, error: "DB_ERROR", message: vErr.message, stage: "vendor_wallet_transactions" });
        }
        vendorTx = vTx || [];
      }
    } catch {
      vendorTxExists = false;
      vendorTx = [];
    }

    // 4) Negative balances (views exist per your schema snapshot)
    const { data: dBal, error: dBalErr } = await admin
      .from("driver_wallet_balances_v1")
      .select("driver_id,balance,last_tx_at,tx_count")
      .lt("balance", 0)
      .order("balance", { ascending: true })
      .limit(200);

    if (dBalErr) {
      return json(500, { ok: false, error: "DB_ERROR", message: dBalErr.message, stage: "driver_wallet_balances_v1" });
    }

    const { data: vBal, error: vBalErr } = await admin
      .from("vendor_wallet_balances_v1")
      .select("vendor_id,balance,last_tx_at,tx_count")
      .lt("balance", 0)
      .order("balance", { ascending: true })
      .limit(200);

    if (vBalErr) {
      return json(500, { ok: false, error: "DB_ERROR", message: vBalErr.message, stage: "vendor_wallet_balances_v1" });
    }

    // ---- Compute flags ----

    // Driver: detect per booking_id credit presence + duplicates
    const txByBooking: Record<string, any[]> = {};
    for (const t of driverTx) {
      const bid = s((t as any).booking_id);
      if (!bid) continue;
      if (!txByBooking[bid]) txByBooking[bid] = [];
      txByBooking[bid].push(t);
    }

    // missing driver credit (completed booking has driver_id but no wallet tx linked)
    const missing_driver_credits = completed
      .filter((b: any) => !!b.driver_id)
      .filter((b: any) => !txByBooking[s(b.id)] || txByBooking[s(b.id)].length === 0)
      .map((b: any) => ({
        booking_id: b.id,
        booking_code: b.booking_code ?? null,
        driver_id: b.driver_id ?? null,
        service_type: b.service_type ?? null,
        completed_at: b.completed_at ?? null,
        updated_at: b.updated_at ?? null,
      }))
      .slice(0, 300);

    const duplicate_driver_credits = Object.keys(txByBooking)
      .filter((bid) => (txByBooking[bid]?.length || 0) > 1)
      .map((bid) => ({
        booking_id: bid,
        count: txByBooking[bid].length,
        tx: txByBooking[bid].slice(0, 5),
      }))
      .slice(0, 200);

    // Vendor: only for takeout where vendor_status completed and booking_code present
    const vtxByCode: Record<string, any[]> = {};
    for (const t of vendorTx) {
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
        // vendor earning tx should exist; in your schema: kind='earning'
        return list.filter((t: any) => s(t.kind).toLowerCase() === "earning").length === 0;
      })
      .map((b: any) => ({
        booking_code: b.booking_code,
        booking_id: b.id,
        vendor_id: b.vendor_id ?? null,
        vendor_status: b.vendor_status ?? null,
        completed_at: b.completed_at ?? null,
        updated_at: b.updated_at ?? null,
      }))
      .slice(0, 300);

    const duplicate_vendor_earnings = Object.keys(vtxByCode)
      .map((code) => {
        const earnings = (vtxByCode[code] || []).filter((t: any) => s(t.kind).toLowerCase() === "earning");
        return { code, earnings };
      })
      .filter((x) => x.earnings.length > 1)
      .map((x) => ({
        booking_code: x.code,
        count: x.earnings.length,
        tx: x.earnings.slice(0, 5),
      }))
      .slice(0, 200);

    const summary = {
      completed_count: completed.length,
      completed_takeout_vendor_completed_count: takeoutCompleted.length,
      driver_tx_seen: driverTx.length,
      vendor_tx_seen: vendorTxExists ? vendorTx.length : 0,
      missing_driver_credits_count: missing_driver_credits.length,
      missing_vendor_credits_count: missing_vendor_credits.length,
      duplicate_driver_credits_count: duplicate_driver_credits.length,
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
      note: vendorTxExists ? null : "vendor_wallet_transactions table not accessible; vendor checks may be incomplete",
    });
  } catch (e: any) {
    return json(500, { ok: false, error: "SERVER_ERROR", message: String(e?.message || e || "Unknown") });
  }
}