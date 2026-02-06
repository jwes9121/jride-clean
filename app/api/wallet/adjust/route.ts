import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function bad(message: string, code: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}
function ok(data: any = {}) {
  return NextResponse.json(
    { ok: true, ...data },
    { headers: { "Cache-Control": "no-store" } }
  );
}
function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
function requireAdminKey(req: Request) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return true;
  const got = req.headers.get("x-admin-key") || "";
  return got === expected;
}

export async function POST(req: Request) {
  try {
    if (!requireAdminKey(req)) return bad("Invalid admin key", "BAD_ADMIN_KEY", 401);

    const body = await req.json().catch(() => ({} as any));
    const mode = String(body?.mode || "topup").toLowerCase(); // topup | cashout
    const driver_id = String(body?.driver_id || "").trim();
    const amount = Number(body?.amount || 0);

    const created_by = String(body?.created_by || "admin").trim() || "admin";
    const method = body?.method == null ? null : String(body.method).trim();
    const external_ref = body?.external_ref == null ? null : String(body.external_ref).trim();
    const request_id = body?.request_id ? String(body.request_id).trim() : null;

    const reason =
      String(body?.reason || "").trim() ||
      (mode === "cashout" ? "Driver Load Wallet Cashout (Manual Payout)" : "Manual Topup");

    if (!isUuid(driver_id)) return bad("Invalid driver_id UUID", "BAD_DRIVER_ID");
    if (!Number.isFinite(amount) || amount <= 0) return bad("amount must be > 0", "BAD_AMOUNT");

    if (mode === "topup") {
      const { data, error } = await supabase.rpc("admin_adjust_driver_wallet_audited" as any, {
        p_driver_id: driver_id,
        p_amount: amount,
        p_reason: reason,
        p_created_by: created_by,
        p_method: method,
        p_external_ref: external_ref,
        p_request_id: request_id
      } as any);

      if (error) return bad("RPC failed", "RPC_FAILED", 500, { details: error.message });
      return ok({ mode: "topup", result: data });
    }

    if (mode === "cashout") {
      const { data, error } = await supabase.rpc("admin_driver_cashout_load_wallet" as any, {
        p_driver_id: driver_id,
        p_cashout_amount: amount,
        p_created_by: created_by,
        p_method: method,
        p_external_ref: external_ref,
        p_request_id: request_id
      } as any);

      if (error) return bad("RPC failed", "RPC_FAILED", 500, { details: error.message });
      return ok({ mode: "cashout", result: data });
    }

    return bad("Invalid mode. Use topup|cashout", "BAD_MODE");
  } catch (e: any) {
    return bad("Unhandled error", "UNHANDLED", 500, { details: String(e?.message || e) });
  }
}
