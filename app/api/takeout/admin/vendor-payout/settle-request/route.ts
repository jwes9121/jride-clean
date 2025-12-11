import { NextResponse } from "next/server";
import { auth } from "@/auth";
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
      console.error("❌ Supabase env vars missing in admin settle-request API");
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    const session = await auth();
    const adminEmail = session?.user?.email as string | undefined;
    if (!adminEmail) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { requestId } = body;

    if (!requestId) {
      return NextResponse.json(
        { error: "Missing requestId" },
        { status: 400 }
      );
    }

    // 1) Load payout request
    const { data: requestRows, error: requestError } = await supabase
      .from("vendor_payout_requests")
      .select(
        "id,vendor_id,requested_amount,status,note,created_at,reviewed_at,reviewed_by"
      )
      .eq("id", requestId)
      .limit(1);

    if (requestError) {
      console.error("❌ vendor_payout_requests load error:", requestError);
      return NextResponse.json(
        { error: requestError.message },
        { status: 500 }
      );
    }

    const request = requestRows && requestRows[0];
    if (!request) {
      return NextResponse.json(
        { error: "Payout request not found" },
        { status: 404 }
      );
    }

    if (request.status !== "pending") {
      return NextResponse.json(
        { error: "Payout request is not pending" },
        { status: 400 }
      );
    }

    const vendorId = request.vendor_id as string;
    const amount = Number(request.requested_amount ?? 0);

    if (amount <= 0) {
      return NextResponse.json(
        { error: "Requested amount is invalid" },
        { status: 400 }
      );
    }

    // 2) Insert wallet transaction as payout (cash paid)
    const payoutNote =
      request.note ??
      "Cash payout settlement approved from admin takeout dashboard";

    const { error: walletInsertError } = await supabase
      .from("vendor_wallet_transactions")
      .insert({
        vendor_id: vendorId,
        booking_code: null,
        amount: amount,
        kind: "payout",
        note: payoutNote,
      });

    if (walletInsertError) {
      console.error(
        "❌ vendor_wallet_transactions insert error:",
        walletInsertError
      );
      return NextResponse.json(
        { error: walletInsertError.message },
        { status: 500 }
      );
    }

    // 3) Mark request as paid
    const { data: updatedRows, error: updateError } = await supabase
      .from("vendor_payout_requests")
      .update({
        status: "paid",
        reviewed_at: new Date().toISOString(),
        reviewed_by: adminEmail,
      })
      .eq("id", requestId)
      .eq("status", "pending")
      .select()
      .limit(1);

    if (updateError) {
      console.error("❌ vendor_payout_requests update error:", updateError);
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    const updated = updatedRows && updatedRows[0];

    return NextResponse.json({ request: updated });
  } catch (err: any) {
    console.error("❌ admin settle-request API error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
