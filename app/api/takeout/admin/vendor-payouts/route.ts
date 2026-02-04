import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

export async function GET() {
  try {
    if (!supabase) {
      console.error("❌ Supabase env vars missing for admin vendor payouts API");
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    const { data, error } = await supabase
      .from("admin_vendor_payout_summary")
      .select("*")
      .order("total_vendor_earnings", { ascending: false });

    if (error) {
      console.error("❌ Error loading admin_vendor_payout_summary:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ vendors: data ?? [] });
  } catch (err: any) {
    console.error("❌ admin vendor payouts server error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
