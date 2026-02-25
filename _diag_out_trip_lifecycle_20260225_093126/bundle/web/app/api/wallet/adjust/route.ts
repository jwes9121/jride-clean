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

export async function POST(req: Request) {
  try {
    const auth = requireAdminKey(req);
    if (!auth.ok) return auth.res;

    const supabase = supabaseAdmin();
    const body = await req.json().catch(() => ({} as any));

    const kind = String(body.kind || "driver_adjust");
    if (kind !== "driver_adjust") {
      return NextResponse.json({ ok: false, error: "ONLY_DRIVER_ADJUST_SUPPORTED" }, { status: 400 });
    }

    const driverId = String(body.driver_id || "").trim();
    const rawAmount = Number(body.amount || 0);
    const reasonMode = String(body.reason_mode || "manual_topup").trim();
    const createdBy = String(body.created_by || "admin").trim();
    const method = String(body.method || "gcash").trim();
    const externalRef = (body.external_ref ?? null) ? String(body.external_ref).trim() : null;
    const requestId = (body.request_id ?? null) ? String(body.request_id).trim() : null;

    if (!driverId) return NextResponse.json({ ok: false, error: "MISSING_DRIVER_ID" }, { status: 400 });
    if (!Number.isFinite(rawAmount) || rawAmount === 0) return NextResponse.json({ ok: false, error: "INVALID_AMOUNT" }, { status: 400 });

    // CASHOUT path uses DB function you already tested:
    // admin_driver_cashout_load_wallet(p_driver_id uuid, p_cashout_amount numeric, p_created_by text, p_method text, p_external_ref text, p_request_id uuid)
    if (reasonMode === "manual_cashout") {
      const cashoutAmount = Math.abs(rawAmount); // DB function will debit using -amount internally
      const { data, error } = await supabase.rpc("admin_driver_cashout_load_wallet", {
        p_driver_id: driverId,
        p_cashout_amount: cashoutAmount,
        p_created_by: createdBy,
        p_method: method,
        p_external_ref: externalRef,
        p_request_id: requestId,
      });

      if (error) return NextResponse.json({ ok: false, error: "CASHOUT_FAILED", message: error.message }, { status: 500 });
      return NextResponse.json(data ?? { ok: true });
    }

    // TOPUP path (audited)
    const amount = Math.abs(rawAmount);
    const reasonText = String(body.reason || "Manual Topup (Admin Credit)").trim() || "Manual Topup (Admin Credit)";

    const { data, error } = await supabase.rpc("admin_adjust_driver_wallet_audited", {
      p_driver_id: driverId,
      p_amount: amount,
      p_reason: reasonText,
      p_created_by: createdBy,
      p_method: method,
      p_external_ref: externalRef,
      p_request_id: requestId,
    });

    if (error) return NextResponse.json({ ok: false, error: "TOPUP_FAILED", message: error.message }, { status: 500 });
    return NextResponse.json(data ?? { ok: true });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "UNEXPECTED", message: e?.message || String(e) }, { status: 500 });
  }
}