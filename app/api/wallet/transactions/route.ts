import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const supabase = supabaseAdmin();
  const url = new URL(req.url);
  const driverId = url.searchParams.get("driver_id");

  const { data: driver } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", driverId)
    .single();

  const { data: txs } = await supabase
    .from("driver_wallet_transactions")
    .select("*")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false });

  return NextResponse.json({
    ok: true,
    driver,
    transactions: txs || []
  });
}
