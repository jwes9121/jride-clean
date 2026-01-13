import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function s(v: any) {
  return String(v ?? "").trim();
}

function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;

  return createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(req: NextRequest) {
  try {
    const admin = getAdmin();
    if (!admin) {
      return json(500, {
        ok: false,
        code: "SERVER_MISCONFIG",
        message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1000);

    const { data, error } = await admin
      .from("vendor_wallet_balances_v1")
      .select("vendor_id,balance,last_tx_at,tx_count")
      .order("balance", { ascending: false })
      .limit(limit);

    if (error) {
      return json(500, { ok: false, code: "DB_ERROR", message: error.message });
    }

    return json(200, { ok: true, vendors: data ?? [] });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: String(e?.message || e || "Unknown") });
  }
}

type VendorSettleReq = {
  action?: string | null;
  vendor_id?: string | null;
  vendorId?: string | null;
  note?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const admin = getAdmin();
    if (!admin) {
      return json(500, {
        ok: false,
        code: "SERVER_MISCONFIG",
        message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const body = (await req.json().catch(() => ({}))) as VendorSettleReq;
    const action = s(body.action).toLowerCase();
    if (action !== "settle") {
      return json(400, { ok: false, code: "BAD_REQUEST", message: "action must be 'settle'" });
    }

    const vendor_id = s(body.vendor_id ?? body.vendorId);
    if (!vendor_id) {
      return json(400, { ok: false, code: "BAD_REQUEST", message: "vendor_id required" });
    }

    const note = (body.note === null || body.note === undefined) ? null : s(body.note);

    // Calls DB function: settle_vendor_wallet(v_vendor_id uuid, v_note text DEFAULT ...)
    const { error } = await admin.rpc("settle_vendor_wallet", {
      v_vendor_id: vendor_id,
      v_note: note && note.length ? note : "Cash payout settlement",
    });

    if (error) {
      return json(500, { ok: false, code: "RPC_ERROR", message: error.message });
    }

    return json(200, { ok: true, vendor_id, settled: true });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: String(e?.message || e || "Unknown") });
  }
}