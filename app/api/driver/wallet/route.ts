import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const driverId = searchParams.get("driver_id");

    if (!driverId) {
      return NextResponse.json(
        { ok: false, error: "driver_id is required" },
        { status: 400 }
      );
    }

    // 1) Fetch driver wallet state (SOURCE OF TRUTH)
    const { data: driver, error: dErr } = await supabase
      .from("drivers")
      .select("id, wallet_balance, min_wallet_required, wallet_locked")
      .eq("id", driverId)
      .single();

    if (dErr || !driver) {
      return NextResponse.json(
        { ok: false, error: "Driver not found" },
        { status: 404 }
      );
    }

    const balance = Number(driver.wallet_balance ?? 0);
    const minRequired = Number(driver.min_wallet_required ?? 0);
    const walletLocked = !!driver.wallet_locked;

    let walletStatus = "OK";
    if (walletLocked) walletStatus = "LOCKED";
    else if (balance < minRequired) walletStatus = "LOW";

    // 2) Fetch last 20 ledger rows (HISTORY ONLY)
    const { data: txs, error: tErr } = await supabase
      .from("driver_wallet_transactions")
      .select("id, amount, balance_after, reason, booking_id, created_at")
      .eq("id", driverId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (tErr) {
      return NextResponse.json(
        { ok: false, error: "Failed to fetch transactions" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      driver_id: driverId,
      balance,
      min_wallet_required: minRequired,
      wallet_locked: walletLocked,
      wallet_status: walletStatus,
      transactions: txs ?? []
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}

