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
      console.error("❌ Supabase env vars missing for vendor request-payout API");
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
      .select("id,email,display_name")
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

    // 2) Current wallet balance from summary view
    const { data: summaryRows, error: summaryError } = await supabase
      .from("admin_vendor_payout_summary")
      .select("wallet_balance")
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
    const walletBalance = Number(summary?.wallet_balance ?? 0);

    if (!summary || walletBalance <= 0.009) {
      return NextResponse.json(
        { error: "No wallet balance available for payout." },
        { status: 400 }
      );
    }

    // 3) Check for existing pending request
    const { data: existingRows, error: existingError } = await supabase
      .from("vendor_payout_requests")
      .select("id,status,created_at")
      .eq("vendor_id", vendorId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1);

    if (existingError) {
      console.error("❌ Error checking existing payout requests:", existingError);
      return NextResponse.json(
        { error: existingError.message },
        { status: 500 }
      );
    }

    if (existingRows && existingRows.length > 0) {
      return NextResponse.json(
        { error: "You already have a pending payout request." },
        { status: 400 }
      );
    }

    // 4) Insert new payout request for full wallet balance
    const { data: insertedRows, error: insertError } = await supabase
      .from("vendor_payout_requests")
      .insert({
        vendor_id: vendorId,
        requested_amount: walletBalance,
        status: "pending",
        note: null,
      })
      .select()
      .limit(1);

    if (insertError) {
      console.error("❌ Error inserting vendor_payout_requests:", insertError);
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    const request = insertedRows && insertedRows[0];

    return NextResponse.json({ request });
  } catch (err: any) {
    console.error("❌ vendor request-payout API error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
