import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function json(status: number, body: any) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ""));
}
function isNumericId(v: string) {
  return /^[0-9]+$/.test(String(v || "").trim());
}
function isIdOk(v: string) {
  return isUuid(v) || isNumericId(v);
}

async function tryBalanceSources(vendor_id: string) {
  const sources = ["vendor_wallet_balance_view", "vendor_wallet_balances_v1"];
  for (const src of sources) {
    const r = await supabase.from(src).select("*").eq("vendor_id", vendor_id).maybeSingle();
    if (!r.error && r.data) return { source: src, row: r.data };
  }
  return { source: null as any, row: null as any };
}

async function fetchVendorTx(vendor_id: string, limit: number) {
  // vendor_wallet_transactions has created_at (per your schema snapshot)
  const r = await supabase
    .from("vendor_wallet_transactions")
    .select("*")
    .eq("vendor_id", vendor_id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!r.error) return r.data || [];

  // fallback: try id
  const r2 = await supabase
    .from("vendor_wallet_transactions")
    .select("*")
    .eq("vendor_id", vendor_id)
    .order("id", { ascending: false })
    .limit(limit);

  if (r2.error) throw r2.error;
  return r2.data || [];
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const vendor_id = String(url.searchParams.get("vendor_id") || "").trim();
    if (!vendor_id) return json(400, { ok: false, code: "MISSING_VENDOR_ID", message: "vendor_id is required" });
    if (!isIdOk(vendor_id)) return json(400, { ok: false, code: "BAD_VENDOR_ID", message: "vendor_id must be uuid or numeric id" });

    const bal = await tryBalanceSources(vendor_id);
    const last = await fetchVendorTx(vendor_id, 20);

    return json(200, {
      ok: true,
      vendor_id,
      balance_source: bal.source,
      balance_row: bal.row,
      last_tx: last,
    });
  } catch (e: any) {
    return json(500, { ok: false, code: "UNHANDLED", message: String(e?.message || e) });
  }
}