import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

function num(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function computeTotals(row: any) {
  const base = num(row.base_fee);
  const dist = num(row.distance_fare);
  const wait = num(row.waiting_fee);
  const extra = num(row.extra_stop_fee);
  const platform = num(row.company_cut);

  const items_total = base + dist + wait + extra;
  const total_bill = items_total + platform; // matches receipt "Total paid"

  return {
    items_total,
    platform_fee: platform,
    total_bill,
  };
}

export async function GET() {
  try {
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    const { data, error } = await supabase
      .from("bookings")
      .select(
        `
        id,
        booking_code,
        service_type,
        status,
        customer_status,
        vendor_status,
        created_at,
        updated_at,
        base_fee,
        distance_fare,
        waiting_fee,
        extra_stop_fee,
        company_cut,
        driver_payout
      `
      )
      .eq("service_type", "takeout")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("❌ orders-list error:", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const orders = (data ?? []).map((row) => {
      const totals = computeTotals(row);
      return {
        ...row,
        ...totals,
      };
    });

    return NextResponse.json({ orders });
  } catch (err: any) {
    console.error("❌ orders-list server error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
