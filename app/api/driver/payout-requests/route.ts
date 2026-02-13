import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}
function s(v: any) { return String(v ?? "").trim(); }
function n(v: any) { const x = Number(v); return Number.isFinite(x) ? x : 0; }

function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// READ-ONLY payout request history
// GET /api/driver/payout-requests?driver_id=UUID&status=all|pending|approved|paid|rejected&limit=50
export async function GET(req: NextRequest) {
  try {
    const admin = getAdmin();
    if (!admin) return json(500, { ok: false, code: "SERVER_MISCONFIG", message: "Missing env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY" });

    const { searchParams } = new URL(req.url);
    const driver_id = s(searchParams.get("driver_id"));
    const status = s(searchParams.get("status") || "all").toLowerCase();
    const limit = Math.min(n(searchParams.get("limit") || 50), 200) || 50;

    if (!driver_id) return json(400, { ok: false, code: "MISSING_DRIVER_ID" });

    let q = admin
      .from("driver_payout_requests")
      .select("id,driver_id,amount,status,requested_at,processed_at,payout_method,payout_ref,receipt_url,admin_note")
      .eq("driver_id", driver_id)
      .order("id", { ascending: false })
      .limit(limit);

    if (status && status !== "all") q = q.eq("status", status);

    const { data, error } = await q;
    if (error) return json(500, { ok: false, code: "DB_ERROR", message: error.message });

    return json(200, { ok: true, driver_id, status, requests: Array.isArray(data) ? data : [] });
  } catch (e: any) {
    return json(500, { ok: false, code: "UNHANDLED", message: String(e?.message || e) });
  }
}