import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function requireAdminKey(req: Request) {
  const required = process.env.ADMIN_API_KEY || "";
  if (!required) return { ok: true as const };
  const got = (req.headers.get("x-admin-key") || "").trim();
  if (!got || got !== required) {
    return { ok: false as const, res: NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 }) };
  }
  return { ok: true as const };
}

function shortId(id: string) {
  const s = String(id || "");
  return s.length > 12 ? `${s.slice(0, 6)}...${s.slice(-4)}` : s;
}

export async function GET(req: Request) {
  try {
    const auth = requireAdminKey(req);
    if (!auth.ok) return auth.res;

    const supabase = supabaseAdmin();
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const driverId = (url.searchParams.get("driver_id") || "").trim();

    if (q) {
      if (q.length < 2) return NextResponse.json({ ok: true, drivers: [] });

      const { data, error } = await supabase
        .from("drivers")
        .select("id, driver_name")
        .ilike("driver_name", `%${q}%`)
        .limit(20);

      if (error) return NextResponse.json({ ok: false, error: "SUGGEST_FAILED", message: error.message }, { status: 500 });

      const drivers = (data || []).map((d: any) => ({
        id: d.id,
        driver_name: d.driver_name || null,
        label: `${d.driver_name || "Driver"} (${shortId(d.id)})`,
      }));

      return NextResponse.json({ ok: true, drivers });
    }

    if (!driverId) return NextResponse.json({ ok: false, error: "MISSING_DRIVER_ID_OR_Q" }, { status: 400 });

    const { data: drow, error: derr } = await supabase
      .from("drivers")
      .select("id, driver_name, wallet_balance, min_wallet_required, wallet_locked, driver_status")
      .eq("id", driverId)
      .limit(1);

    if (derr) return NextResponse.json({ ok: false, error: "DRIVER_READ_FAILED", message: derr.message }, { status: 500 });

    const driver = (drow || [])[0] || null;

    const { data: txs, error: txErr } = await supabase
      .from("driver_wallet_transactions")
      .select("id, created_at, amount, balance_after, reason, booking_id")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (txErr) return NextResponse.json({ ok: false, error: "TX_READ_FAILED", message: txErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, driver, transactions: txs || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "UNEXPECTED", message: e?.message || String(e) }, { status: 500 });
  }
}