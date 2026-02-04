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
      console.error(
        "❌ Supabase env vars missing in admin vendor-payout list-requests API"
      );
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // 1) Fetch all payout requests
    const { data: requestRows, error: requestError } = await supabase
      .from("vendor_payout_requests")
      .select(
        "id,vendor_id,requested_amount,status,note,created_at,reviewed_at,reviewed_by"
      )
      .order("created_at", { ascending: false });

    if (requestError) {
      console.error("❌ vendor_payout_requests list error:", requestError);
      return NextResponse.json(
        { error: requestError.message },
        { status: 500 }
      );
    }

    if (!requestRows || requestRows.length === 0) {
      return NextResponse.json({ requests: [] });
    }

    // 2) Fetch vendor info for all involved vendors
    const vendorIds = Array.from(
      new Set(requestRows.map((r: any) => r.vendor_id).filter(Boolean))
    );

    let vendorMap: Record<
      string,
      { id: string; email: string; display_name: string | null }
    > = {};

    if (vendorIds.length > 0) {
      const { data: vendorRows, error: vendorError } = await supabase
        .from("vendor_accounts")
        .select("id,email,display_name")
        .in("id", vendorIds);

      if (vendorError) {
        console.error("❌ vendor_accounts load for list-requests error:", vendorError);
        return NextResponse.json(
          { error: vendorError.message },
          { status: 500 }
        );
      }

      vendorRows?.forEach((v: any) => {
        vendorMap[v.id] = {
          id: v.id,
          email: v.email,
          display_name: v.display_name ?? null,
        };
      });
    }

    const decorated = (requestRows ?? []).map((r: any) => {
      const vendor = vendorMap[r.vendor_id] || null;
      return {
        ...r,
        vendor_email: vendor?.email ?? null,
        vendor_name: vendor?.display_name ?? null,
      };
    });

    return NextResponse.json({ requests: decorated });
  } catch (err: any) {
    console.error("❌ admin list-requests API error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}

