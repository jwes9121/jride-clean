import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function effectiveMinWalletRequired(raw: unknown): number {
  const configured = Number(raw ?? 0);
  if (Number.isFinite(configured) && configured >= 250) return configured;
  return 250;
}

function withNoStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const driverId = (searchParams.get("driver_id") || "").trim();

    if (!driverId) {
      return withNoStore(
        NextResponse.json({ ok: false, error: "driver_id is required" }, { status: 400 })
      );
    }

    const { data: driver, error: dErr } = await supabase
      .from("drivers")
      .select("id, wallet_balance, min_wallet_required, wallet_locked")
      .eq("id", driverId)
      .maybeSingle();

    if (dErr || !driver) {
      return withNoStore(
        NextResponse.json({ ok: false, error: "Driver not found" }, { status: 404 })
      );
    }

    const { data: txs, error: tErr } = await supabase
      .from("driver_wallet_transactions")
      .select("id, amount, balance_after, reason, booking_id, created_at")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (tErr) {
      return withNoStore(
        NextResponse.json({ ok: false, error: "Failed to fetch transactions" }, { status: 500 })
      );
    }

    const ledgerBalance = (txs || []).reduce((sum: number, row: any) => sum + Number(row?.amount ?? 0), 0);
    const snapshotBalance = Number(driver.wallet_balance ?? 0);
    const balance = (txs || []).length > 0 ? ledgerBalance : snapshotBalance;
    const minRequired = effectiveMinWalletRequired(driver.min_wallet_required);
    const walletLocked = !!driver.wallet_locked;

    let walletStatus = "OK";
    if (walletLocked) walletStatus = "LOCKED";
    else if (balance < minRequired) walletStatus = "LOW";

    return withNoStore(
      NextResponse.json({
        ok: true,
        driver_id: driverId,
        balance,
        snapshot_balance: snapshotBalance,
        ledger_balance: ledgerBalance,
        min_wallet_required: minRequired,
        wallet_locked: walletLocked,
        wallet_status: walletStatus,
        transactions: txs || []
      })
    );
  } catch (e: any) {
    return withNoStore(
      NextResponse.json({ ok: false, error: e?.message ?? "Unexpected error" }, { status: 500 })
    );
  }
}
