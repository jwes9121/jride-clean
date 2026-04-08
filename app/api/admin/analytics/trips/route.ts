import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from("bookings")
      .select("town, driver_payout, company_cut, status")
      .eq("status", "completed");

    if (error) throw error;

    const map: Record<string, { trips: number; revenue: number }> = {};

    for (const row of data || []) {
      const town = row.town || "Unknown";
      if (!map[town]) {
        map[town] = { trips: 0, revenue: 0 };
      }

      map[town].trips += 1;

      const revenue =
        Number(row.company_cut || 0) +
        Number(row.driver_payout || 0);

      map[town].revenue += revenue;
    }

    const rows = Object.entries(map).map(([town, v]) => ({
      town,
      total_trips: v.trips,
      total_revenue: v.revenue,
    }));

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}