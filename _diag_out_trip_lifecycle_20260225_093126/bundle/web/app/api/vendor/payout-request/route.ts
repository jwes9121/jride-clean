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

function minPayout() {
  const v = n(process.env.VENDOR_PAYOUT_MIN);
  return v > 0 ? v : 250;
}

// DIAGNOSTIC GET: proves route exists + deployed
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return json(200, {
    ok: true,
    route: "/api/vendor/payout-request",
    methods: ["GET", "POST"],
    hint_get: "GET ?vendor_id=UUID&limit=20",
    hint_post: "POST { vendor_id, requested_amount, note? }",
    echo: {
      vendor_id: searchParams.get("vendor_id"),
      limit: searchParams.get("limit"),
    },
    min_payout_default: 250,
    min_payout_env: process.env.VENDOR_PAYOUT_MIN ?? null,
    locked_rules: {
      wallet_mutations: false,
      writes_vendor_wallet_transactions: false,
      schema_changes: false,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const admin = getAdmin();
    if (!admin) {
      return json(500, {
        ok: false,
        code: "SERVER_MISCONFIG",
        message: "Missing required env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const body = await req.json().catch(() => ({} as any));
    const vendor_id = s(body.vendor_id);

    if (!vendor_id || vendor_id.toUpperCase().includes("REPLACE_VENDOR_UUID") || vendor_id.toLowerCase() === "your_vendor_uuid") {
      return json(400, { ok: false, code: "BAD_VENDOR_ID", message: "Provide a real vendor_id UUID." });
    }

    const requested_amount = n(body.requested_amount ?? body.amount);
    const note = s(body.note);

    if (!(requested_amount > 0)) return json(400, { ok: false, code: "BAD_AMOUNT" });

    const min = minPayout();
    if (requested_amount < min) return json(400, { ok: false, code: "BELOW_MIN", min_payout: min });

    // Read-only balance check (NO mutations)
    const { data: balRow, error: balErr } = await admin
      .from("vendor_wallet_balances_v1")
      .select("balance")
      .eq("vendor_id", vendor_id)
      .maybeSingle();

    if (balErr) return json(500, { ok: false, code: "DB_ERROR", stage: "balance", message: balErr.message });

    const balance = n((balRow as any)?.balance);
    if (requested_amount > balance) {
      return json(400, { ok: false, code: "INSUFFICIENT_BALANCE", balance, requested: requested_amount });
    }

    const nowIso = new Date().toISOString();

    // Insert payout request record ONLY (NO wallet tx)
    const { data: ins, error: insErr } = await admin
      .from("vendor_payout_requests")
      .insert({
        vendor_id,
        requested_amount,
        status: "pending",
        note: note || null,
        created_at: nowIso,
        reviewed_at: null,
        reviewed_by: null,
      })
      .select("*")
      .maybeSingle();

    if (insErr) return json(500, { ok: false, code: "DB_ERROR", stage: "insert", message: insErr.message });

    return json(200, { ok: true, request: ins, balance_at_request_time: balance, min_payout: min });
  } catch (e: any) {
    return json(500, { ok: false, code: "UNHANDLED", message: String(e?.message || e) });
  }
}