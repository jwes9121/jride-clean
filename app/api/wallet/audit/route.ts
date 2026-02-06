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

export async function GET(req: Request) {
  try {
    const auth = requireAdminKey(req);
    if (!auth.ok) return auth.res;

    const supabase = supabaseAdmin();
    const url = new URL(req.url);
    const driverId = (url.searchParams.get("driver_id") || "").trim();

    if (!driverId) return NextResponse.json({ ok: false, error: "MISSING_DRIVER_ID" }, { status: 400 });

    const { data, error } = await supabase
      .from("wallet_admin_audit")
      .select("created_at, driver_id, amount, reason, created_by, method, external_ref, receipt_ref, request_id, before_balance, after_balance, status, error_message")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return NextResponse.json({ ok: false, error: "AUDIT_READ_FAILED", message: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, rows: data || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "UNEXPECTED", message: e?.message || String(e) }, { status: 500 });
  }
}