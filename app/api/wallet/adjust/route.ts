import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function requireAdminKey(req: Request) {
  const required = process.env.ADMIN_API_KEY || "";
  if (!required) return { ok: true as const };
  const got = (req.headers.get("x-admin-key") || "").trim();
  if (!got || got !== required) {
    return {
      ok: false as const,
      res: NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 }),
    };
  }
  return { ok: true as const };
}

function ensureReceiptRef(input: any): string {
  const val = (input ?? "").toString().trim();
  if (val) return val;

  const d = new Date();
  const yy = d.getFullYear().toString();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const rand = Math.random().toString(16).slice(2, 6);

  return `JRIDE-WALLET-${yy}${mm}${dd}-${hh}${mi}${ss}-${rand}`;
}

function ensureRequestId(input: any): string {
  const val = (input ?? "").toString().trim();
  return val || randomUUID();
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

    const finalReceiptRef = ensureReceiptRef(body.external_ref);
    const finalRequestId = ensureRequestId(body.request_id);

    if (!driverId) {
      return NextResponse.json({ ok: false, error: "MISSING_DRIVER_ID" }, { status: 400 });
    }

    if (!Number.isFinite(rawAmount) || rawAmount === 0) {
      return NextResponse.json({ ok: false, error: "INVALID_AMOUNT" }, { status: 400 });
    }

    if (reasonMode === "manual_cashout") {
      const cashoutAmount = Math.abs(rawAmount);

      const { data, error } = await supabase.rpc("admin_driver_cashout_load_wallet", {
        p_driver_id: driverId,
        p_cashout_amount: cashoutAmount,
        p_created_by: createdBy,
        p_method: method,
        p_external_ref: finalReceiptRef,
        p_request_id: finalRequestId,
      });

      if (error) {
        return NextResponse.json(
          {
            ok: false,
            error: "CASHOUT_FAILED",
            message: error.message,
            receipt_ref: finalReceiptRef,
            request_id: finalRequestId,
          },
          { status: 500 }
        );
      }

      return NextResponse.json(
        data ?? {
          ok: true,
          receipt_ref: finalReceiptRef,
          request_id: finalRequestId,
        }
      );
    }

    const amount = Math.abs(rawAmount);
    const reasonText =
      String(body.reason || "Manual Topup (Admin Credit)").trim() || "Manual Topup (Admin Credit)";

    const { data, error } = await supabase.rpc("admin_adjust_driver_wallet_audited", {
      p_driver_id: driverId,
      p_amount: amount,
      p_reason: reasonText,
      p_created_by: createdBy,
      p_method: method,
      p_external_ref: finalReceiptRef,
      p_request_id: finalRequestId,
    });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "TOPUP_FAILED",
          message: error.message,
          receipt_ref: finalReceiptRef,
          request_id: finalRequestId,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      data ?? {
        ok: true,
        receipt_ref: finalReceiptRef,
        request_id: finalRequestId,
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "UNEXPECTED", message: e?.message || String(e) },
      { status: 500 }
    );
  }
}