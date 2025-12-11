import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { auth } from "@/auth";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

async function resolveVendorIdFromSession() {
  const session = await auth();

  if (!session || !session.user || !session.user.email) {
    throw new Error("Unauthorized: vendor email missing from session");
  }

  if (!supabase) {
    throw new Error("Supabase not configured");
  }

  const email = String(session.user.email);
  const displayName = session.user.name ?? null;

  const { data, error } = await supabase.rpc(
    "get_or_create_vendor_id_by_email",
    {
      p_email: email,
      p_display_name: displayName,
    }
  );

  if (error) {
    console.error("❌ get_or_create_vendor_id_by_email error:", error);
    throw new Error(error.message || "Failed to resolve vendor ID");
  }

  const vendorId = data as string | null;
  if (!vendorId) {
    throw new Error("Unable to resolve vendor ID for email " + email);
  }

  return vendorId;
}

export async function GET() {
  try {
    if (!supabase) {
      console.error("❌ Supabase env vars missing for vendor-wallet API");
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    const vendorId = await resolveVendorIdFromSession();

    // 0) Auto-sync this vendor's completed TAKEOUT orders into the wallet
    const { error: syncError } = await supabase.rpc(
      "sync_vendor_takeout_wallet",
      { v_vendor_id: vendorId }
    );

    if (syncError) {
      console.error("❌ Error running sync_vendor_takeout_wallet:", syncError);
      // Continue; wallet may still contain previous data.
    }

    // 1) Wallet balance row for this vendor
    const { data: walletRows, error: walletError } = await supabase
      .from("vendor_wallet")
      .select("vendor_id,balance,updated_at")
      .eq("vendor_id", vendorId)
      .limit(1);

    if (walletError) {
      console.error("❌ Error loading vendor_wallet:", walletError);
      return NextResponse.json(
        { error: walletError.message },
        { status: 500 }
      );
    }

    const wallet = walletRows && walletRows.length > 0 ? walletRows[0] : null;

    // 2) Latest wallet transactions for this vendor
    const { data: txRows, error: txError } = await supabase
      .from("vendor_wallet_transactions")
      .select("booking_code,amount,kind,note,created_at")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (txError) {
      console.error("❌ Error loading vendor_wallet_transactions:", txError);
      return NextResponse.json(
        { error: txError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      vendorId,
      balance: wallet?.balance ?? 0,
      updatedAt: wallet?.updated_at ?? null,
      transactions: txRows ?? [],
    });
  } catch (err: any) {
    console.error("❌ vendor-wallet GET server error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    if (!supabase) {
      console.error("❌ Supabase env vars missing for vendor-wallet API");
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    const vendorId = await resolveVendorIdFromSession();

    // Call settle_vendor_wallet to clear the balance via a payout transaction
    const { error: settleError } = await supabase.rpc(
      "settle_vendor_wallet",
      {
        v_vendor_id: vendorId,
        v_note: "Cash payout settlement triggered from vendor dashboard",
      }
    );

    if (settleError) {
      console.error("❌ Error running settle_vendor_wallet:", settleError);
      return NextResponse.json(
        { error: settleError.message ?? "Failed to settle wallet" },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("❌ vendor-wallet POST server error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
