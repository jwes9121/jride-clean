import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";


const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

export async function GET() {
  try {
    if (!supabase) {
      console.error("❌ Supabase env vars missing for vendor payout API");
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    const session = await auth();
    const email = session?.user?.email as string | undefined;

    if (!email) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    // 1) Vendor account
    const { data: vendorRows, error: vendorError } = await supabase
      .from("vendor_accounts")
      .select("id,email,display_name,created_at")
      .eq("email", email)
      .limit(1);

    if (vendorError) {
      console.error("❌ Error loading vendor_accounts:", vendorError);
      return NextResponse.json(
        { error: vendorError.message },
        { status: 500 }
      );
    }

    const vendor = vendorRows && vendorRows[0];
    if (!vendor) {
      return NextResponse.json(
        { error: "No vendor account linked to this email" },
        { status: 404 }
      );
    }

    const vendorId = vendor.id as string;

    // 2) Summary (view used by admin)
    const { data: summaryRows, error: summaryError } = await supabase
      .from("admin_vendor_payout_summary")
      .select("*")
      .eq("vendor_id", vendorId)
      .limit(1);

    if (summaryError) {
      console.error("❌ Error loading admin_vendor_payout_summary:", summaryError);
      return NextResponse.json(
        { error: summaryError.message },
        { status: 500 }
      );
    }

    const summary = summaryRows && summaryRows[0];

    // 3) Monthly earnings/payouts
    const { data: monthlyRows, error: monthlyError } = await supabase
      .from("admin_vendor_payout_monthly")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("month_start", { ascending: false });

    if (monthlyError) {
      console.error("❌ Error loading admin_vendor_payout_monthly:", monthlyError);
      return NextResponse.json(
        { error: monthlyError.message },
        { status: 500 }
      );
    }

    // 4) Orders
    const { data: orderRows, error: orderError } = await supabase
      .from("takeout_pricing_10pct_view")
      .select(
        [
          "id",
          "booking_code",
          "service_type",
          "vendor_status",
          "customer_status",
          "total_service_fare",
          "platform_fee_10pct",
          "vendor_earnings_90pct",
          "created_at",
          "updated_at",
        ].join(",")
      )
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false })
      .limit(300);

    if (orderError) {
      console.error("❌ Error loading vendor orders:", orderError);
      return NextResponse.json(
        { error: orderError.message },
        { status: 500 }
      );
    }

    // 5) Wallet transactions
    const { data: walletTxRows, error: walletError } = await supabase
      .from("vendor_wallet_transactions")
      .select("booking_code,amount,kind,note,created_at")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (walletError) {
      console.error("❌ Error loading vendor_wallet_transactions:", walletError);
      return NextResponse.json(
        { error: walletError.message },
        { status: 500 }
      );
    }

    // 6) Payout requests
    const { data: requestRows, error: requestError } = await supabase
      .from("vendor_payout_requests")
      .select(
        "id,status,requested_amount,note,created_at,reviewed_at,reviewed_by"
      )
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (requestError) {
      console.error("❌ Error loading vendor_payout_requests:", requestError);
      return NextResponse.json(
        { error: requestError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      vendor,
      summary,
      monthly: monthlyRows ?? [],
      orders: orderRows ?? [],
      walletTransactions: walletTxRows ?? [],
      payoutRequests: requestRows ?? [],
    });
  } catch (err: any) {
    console.error("❌ vendor payout API error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}

