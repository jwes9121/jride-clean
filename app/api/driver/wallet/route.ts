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

// READ-ONLY driver wallet snapshot
// GET /api/driver/wallet?driver_id=UUID&tx_limit=30
export async function GET(req: NextRequest) {
  try {
    const admin = getAdmin();
    if (!admin) return json(500, { ok: false, code: "SERVER_MISCONFIG", message: "Missing env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY" });

    const { searchParams } = new URL(req.url);
    const driver_id = s(searchParams.get("driver_id"));
    const tx_limit = Math.min(n(searchParams.get("tx_limit") || 30), 200) || 30;

    if (!driver_id) return json(400, { ok: false, code: "MISSING_DRIVER_ID" });

    // Balance
    const { data: balRow, error: balErr } = await admin
      .from("driver_wallet_balances_v1")
      .select("driver_id,balance")
      .eq("driver_id", driver_id)
      .maybeSingle();

    if (balErr) return json(500, { ok: false, code: "DB_ERROR", stage: "balance", message: balErr.message });

    // Recent transactions (READ-ONLY)
    const { data: txRows, error: txErr } = await admin
      .from("driver_wallet_transactions")
      .select("id,driver_id,amount,balance_after,reason,booking_id,created_at")
      .eq("driver_id", driver_id)
      .order("id", { ascending: false })
      .limit(tx_limit);

    if (txErr) return json(500, { ok: false, code: "DB_ERROR", stage: "tx", message: txErr.message });

    return json(200, {
      ok: true,
      driver_id,
      balance: n((balRow as any)?.balance),
      transactions: Array.isArray(txRows) ? txRows : [],
    });
  } catch (e: any) {
    return json(500, { ok: false, code: "UNHANDLED", message: String(e?.message || e) });
  }
}