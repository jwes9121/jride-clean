import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";


export async function GET(req: Request) {
  const supabase = createRouteHandlerClient({ cookies });

  try {
    const url = new URL(req.url);
    const vendorId = url.searchParams.get("vendorId");

    if (!vendorId) {
      return NextResponse.json({ error: "Missing vendorId" }, { status: 400 });
    }

    // --- KEEP YOUR EXISTING QUERY SHAPE ---
    // NOTE: We intentionally keep this broad select; runtime behavior unchanged.
    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("id", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // ✅ Type-narrow once (TS fix only)
    const rows = (Array.isArray(data) ? data : []) as any[];

    const orders = rows.map((r) => {
      const order = {
        id: r.id,
        booking_code: r.booking_code,
        customer_name: r.passenger_name,
        vendor_status: r.vendor_status,

        // keep extra fields if your UI relies on them (safe defaults)
        service_type: r.service_type,
        status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };

      return order;
    });

    return NextResponse.json({ orders });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

