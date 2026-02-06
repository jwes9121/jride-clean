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

type Body =
  | {
      kind: "driver_adjust";
      driver_id: string;
      amount: number;
      reason: string;
      created_by?: string | null;
      method?: string | null;
      external_ref?: string | null;
      request_id?: string | null;
    }
  | {
      kind: "vendor_adjust";
      vendor_id: string;
      amount: number;
      kind2?: string | null;
      note?: string | null;
    };

export async function POST(req: Request) {
  try {
    const auth = requireAdminKey(req);
    if (!auth.ok) return auth.res;

    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as any as Body;

    if (!body || !("kind" in body)) {
      return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 });
    }

    if (body.kind === "vendor_adjust") {
      const vendorId = String((body as any).vendor_id || "").trim();
      const amount = Number((body as any).amount || 0);
      const kind2 = String((body as any).kind2 || "adjustment");
      const note = String((body as any).note || "manual_adjust");

      if (!vendorId) return NextResponse.json({ ok: false, error: "MISSING_VENDOR_ID" }, { status: 400 });
      if (!Number.isFinite(amount) || amount === 0) {
        return NextResponse.json({ ok: false, error: "INVALID_AMOUNT" }, { status: 400 });
      }

      const { data, error } = await supabase
        .from("vendor_wallet_transactions")
        .insert({
          vendor_id: vendorId,
          amount,
          kind: kind2,
          note,
          booking_code: null,
        })
        .select("*")
        .limit(1);

      if (error) {
        return NextResponse.json({ ok: false, error: "VENDOR_ADJUST_FAILED", message: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, kind: "vendor_adjust", row: (data || [])[0] || null });
    }

    const driverId = String((body as any).driver_id || "").trim();
    const amount = Number((body as any).amount || 0);
    const reason = String((body as any).reason || "").trim();
    const createdBy = String((body as any).created_by || "admin").trim();

    const method = String((body as any).method || "admin").trim();
    const externalRef = ((body as any).external_ref ?? null) ? String((body as any).external_ref).trim() : null;
    const requestId = ((body as any).request_id ?? null) ? String((body as any).request_id).trim() : (globalThis.crypto?.randomUUID?.() ?? null);

    if (!driverId) return NextResponse.json({ ok: false, error: "MISSING_DRIVER_ID" }, { status: 400 });
    if (!Number.isFinite(amount) || amount === 0) return NextResponse.json({ ok: false, error: "INVALID_AMOUNT" }, { status: 400 });
    if (!reason) return NextResponse.json({ ok: false, error: "MISSING_REASON" }, { status: 400 });

    try {
      const { data, error } = await supabase.rpc("admin_adjust_driver_wallet_audited", {
        p_driver_id: driverId,
        p_amount: amount,
        p_reason: reason,
        p_created_by: createdBy,
        p_method: method,
        p_external_ref: externalRef,
        p_request_id: requestId,
      });

      if (error) {
        const msg = (error.message || "").toLowerCase();
        if (msg.includes("does not exist") || msg.includes("function")) throw error;
        return NextResponse.json({ ok: false, error: "DRIVER_ADJUST_FAILED", message: error.message }, { status: 500 });
      }

      return NextResponse.json(data ?? { ok: true });
    } catch {
      const { data, error } = await supabase.rpc("admin_adjust_driver_wallet", {
        p_driver_id: driverId,
        p_amount: amount,
        p_reason: reason,
        p_created_by: createdBy,
      });

      if (error) return NextResponse.json({ ok: false, error: "DRIVER_ADJUST_FAILED", message: error.message }, { status: 500 });
      return NextResponse.json(data ?? { ok: true });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "UNEXPECTED", message: e?.message || String(e) }, { status: 500 });
  }
}