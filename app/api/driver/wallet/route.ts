import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function withNoStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return res;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const driverId = searchParams.get("driver_id");

  if (!driverId) {
    return withNoStore(NextResponse.json({ ok: false }));
  }

  const { data: driver } = await supabase
    .from("drivers")
    .select("wallet_balance")
    .eq("id", driverId)
    .single();

  const { data: txs } = await supabase
    .from("driver_wallet_transactions")
    .select("*")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false });

  return withNoStore(
    NextResponse.json({
      ok: true,
      balance: driver?.wallet_balance,
      transactions: txs || []
    })
  );
}
