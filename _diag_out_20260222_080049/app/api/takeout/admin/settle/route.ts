import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

export async function POST(req: Request) {
  try {
    if (!supabase) {
      console.error("❌ Supabase env vars missing for admin settle API");
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const vendorId = body.vendorId as string | undefined;

    if (!vendorId) {
      return NextResponse.json(
        { error: "Missing vendorId" },
        { status: 400 }
      );
    }

    // Call the existing settlement RPC used by the vendor dashboard
    const { error: settleError } = await supabase.rpc(
      "settle_vendor_wallet",
      {
        v_vendor_id: vendorId,
        v_note: "Cash payout settlement triggered from admin dashboard",
      }
    );

    if (settleError) {
      console.error("❌ settle_vendor_wallet error:", settleError);
      return NextResponse.json(
        { error: settleError.message ?? "Failed to settle wallet" },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("❌ admin settle server error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
