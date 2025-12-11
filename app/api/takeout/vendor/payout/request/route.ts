import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

export async function POST() {
  try {
    if (!supabase) {
      console.error("❌ Supabase env vars missing in vendor payout request API");
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    const session = await auth();
    const email = session?.user?.email as string | undefined;
    if (!email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // 1) Resolve vendor by email
    const { data: vendorRows, error: vendorError } = await supabase
      .from("vendor_accounts")
      .select("id,email,display_name")
      .eq("email", email)
      .limit(1);

    if (vendorError) {
      console.error("❌ vendor_accounts error:", vendorError);
      return NextResponse.json(
        { error: vendorError.message },
        { status: 500 }
      );
    }

    const vendor = vendorRows && vendorRows[0];
    if (!vendor) {
      return NextResponse.json(
        { error: "Vendor account not found for this user" },
        { status: 404 }
      );
    }

    const vendorId = vendor.id as string;

    // 2) Get wallet balance for this vendor
    const { data: summaryRows, error: summaryError } = await supabase
      .from("admin_vendor_payout_summary")
      .select("wallet_balance")
      .eq("vendor_id", vendorId)
      .limit(1);

    if (summaryError) {
      console.error("❌ admin_vendor_payout_summary error:", summaryError);
      return NextResponse.json(
        { error: summaryError.message },
        { status: 500 }
      );
    }

    const walletBalance = Number(summaryRows?.[0]?.wallet_balance ?? 0);

    if (walletBalance <= 0) {
      return NextResponse.json(
        { error: "No wallet balance available for payout." },
        { status: 400 }
      );
    }

    // 3) Check for existing pending payout request
    const { data: pendingRows, error: pendingError } = await supabase
      .from("vendor_payout_requests")
      .select("id,status")
      .eq("vendor_id", vendorId)
      .eq("status", "pending")
      .limit(1);

    if (pendingError) {
      console.error("❌ vendor_payout_requests pending check error:", pendingError);
      return NextResponse.json(
        { error: pendingError.message },
        { status: 500 }
      );
    }

    if (pendingRows && pendingRows.length > 0) {
      return NextResponse.json(
        {
          error:
            "You already have a pending payout request. Please wait for admin approval.",
        },
        { status: 400 }
      );
    }

    // 4) Create payout request for full wallet balance
    const { data: insertRows, error: insertError } = await supabase
      .from("vendor_payout_requests")
      .insert({
        vendor_id: vendorId,
        requested_amount: walletBalance,
        status: "pending",
        note: "Payout request submitted from vendor dashboard",
      })
      .select()
      .limit(1);

    if (insertError) {
      console.error("❌ vendor_payout_requests insert error:", insertError);
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    const request = insertRows && insertRows[0];

    return NextResponse.json({ request });
  } catch (err: any) {
    console.error("❌ vendor payout request API error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
