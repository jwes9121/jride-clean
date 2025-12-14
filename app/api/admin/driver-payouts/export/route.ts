import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function toCsv(rows: any[]) {
  if (!rows.length) return "id,driver_id,amount,status,requested_at,processed_at,processed_by,admin_note\n";
  const cols = ["id","driver_id","amount","status","requested_at","processed_at","processed_by","admin_note"];
  const esc = (v: any) => {
    const s = (v ?? "").toString();
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = cols.join(",") + "\n";
  const body = rows.map(r => cols.map(c => esc(r[c])).join(",")).join("\n") + "\n";
  return head + body;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const status = searchParams.get("status");

  const sb = supabaseAdmin();
  let q = sb.from("driver_payout_requests")
    .select("id,driver_id,amount,status,requested_at,processed_at,processed_by,admin_note")
    .order("requested_at", { ascending: false })
    .limit(5000);

  if (from) q = q.gte("requested_at", from);
  if (to) q = q.lte("requested_at", to);
  if (status && status !== "all") q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const csv = toCsv(data || []);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="driver_payouts_export.csv"`,
    },
  });
}
