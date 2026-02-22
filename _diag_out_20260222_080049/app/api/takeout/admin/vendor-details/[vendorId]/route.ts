import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

export async function GET(
  _req: Request,
  { params }: { params: { vendorId: string } }
) {
  try {
    if (!supabase) {
      console.error("❌ Supabase env vars missing in admin vendor-details API");
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    // Basic auth check (you are using the same Google account for admin)
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const vendorId = params.vendorId;
    if (!vendorId) {
      return NextResponse.json({ error: "Missing vendorId" }, { status: 400 });
    }

    // 1) Vendor info
    const { data: vendorRows, error: vendorError } = await supabase
      .from("vendor_accounts")
      .select("id,email,display_name,created_at")
      .eq("id", vendorId)
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
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }

    // 2) Summary (admin_vendor_payout_summary)
    const { data: summaryRows, error: summaryError } = await supabase
      .from("admin_vendor_payout_summary")
      .select(
        "vendor_id,total_billings,total_platform_fees,total_vendor_earnings,wallet_balance,last_payout_at,last_payout_amount"
      )
      .eq("vendor_id", vendorId)
      .limit(1);

    if (summaryError) {
      console.error("❌ admin_vendor_payout_summary error:", summaryError);
      return NextResponse.json(
        { error: summaryError.message },
        { status: 500 }
      );
    }

    const summary = summaryRows && summaryRows[0];

    // 3) Monthly view (admin_vendor_payout_monthly)
    const { data: monthlyRows, error: monthlyError } = await supabase
      .from("admin_vendor_payout_monthly")
      .select(
        "vendor_id,month_start,total_billings,total_platform_fees,total_vendor_earnings,total_payouts"
      )
      .eq("vendor_id", vendorId)
      .order("month_start", { ascending: false });

    if (monthlyError) {
      console.error("❌ admin_vendor_payout_monthly error:", monthlyError);
      return NextResponse.json(
        { error: monthlyError.message },
        { status: 500 }
      );
    }

    // 4) Orders (takeout_pricing_10pct_view)
    const { data: orderRows, error: orderError } = await supabase
      .from("takeout_pricing_10pct_view")
      .select(
        "id,booking_code,service_type,vendor_status,customer_status,total_service_fare,platform_fee_10pct,vendor_earnings_90pct,created_at,updated_at"
      )
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false });

    if (orderError) {
      console.error("❌ takeout_pricing_10pct_view error:", orderError);
      return NextResponse.json(
        { error: orderError.message },
        { status: 500 }
      );
    }

    // 5) Wallet transactions
    const { data: walletRows, error: walletError } = await supabase
      .from("vendor_wallet_transactions")
      .select("booking_code,amount,kind,note,created_at")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false });

    if (walletError) {
      console.error("❌ vendor_wallet_transactions error:", walletError);
      return NextResponse.json(
        { error: walletError.message },
        { status: 500 }
      );
    }

    // 6) Payout requests
    const { data: payoutRows, error: payoutError } = await supabase
      .from("vendor_payout_requests")
      .select(
        "id,vendor_id,requested_amount,status,note,created_at,reviewed_at,reviewed_by"
      )
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false });

    if (payoutError) {
      console.error("❌ vendor_payout_requests error:", payoutError);
      return NextResponse.json(
        { error: payoutError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      vendor,
      summary,
      monthly: monthlyRows ?? [],
      orders: orderRows ?? [],
      walletTransactions: walletRows ?? [],
      payoutRequests: payoutRows ?? [],
    });
  } catch (err: any) {
    console.error("❌ admin vendor-details API error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
