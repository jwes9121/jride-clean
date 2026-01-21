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

async function tryBalanceSources(driver_id: string) {
  const sources = ["driver_wallet_balances_v1"];
  for (const src of sources) {
    const r = await supabase.from(src).select("*").eq("driver_id", driver_id).maybeSingle();
    if (!r.error && r.data) return { source: src, row: r.data };
  }
  return { source: null as any, row: null as any };
}

async function fetchDriverTx(driver_id: string, limit: number) {
  // driver_wallet_transactions has created_at (per your schema snapshot)
  const r = await supabase
    .from("driver_wallet_transactions")
    .select("*")
    .eq("driver_id", driver_id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!r.error) return r.data || [];

  // fallback: if ordering field differs, try id
  const r2 = await supabase
    .from("driver_wallet_transactions")
    .select("*")
    .eq("driver_id", driver_id)
    .order("id", { ascending: false })
    .limit(limit);

  if (r2.error) throw r2.error;
  return r2.data || [];
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const driver_id = String(url.searchParams.get("driver_id") || "").trim();
    if (!driver_id) return json(400, { ok: false, code: "MISSING_DRIVER_ID", message: "driver_id is required" });
    if (!isIdOk(driver_id)) return json(400, { ok: false, code: "BAD_DRIVER_ID", message: "driver_id must be uuid or numeric id" });

    const bal = await tryBalanceSources(driver_id);
    const last = await fetchDriverTx(driver_id, 20);

    return json(200, {
      ok: true,
      driver_id,
      balance_source: bal.source,
      balance_row: bal.row,
      last_tx: last,
    });
  } catch (e: any) {
    return json(500, { ok: false, code: "UNHANDLED", message: String(e?.message || e) });
  }
}